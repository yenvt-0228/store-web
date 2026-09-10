import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Consumer, EachMessagePayload } from 'kafkajs';
import { RedisService } from '../redis/redis.service';
import {
  KAFKA_DEDUP_TTL_SECONDS,
  KAFKA_DLQ_TOPIC,
  KAFKA_HANDLER_ATTEMPTS,
  KAFKA_HANDLER_RETRY_DELAY_MS,
  KAFKA_RESTART_DELAY_MS,
  KafkaEnvelope,
  KafkaTopic,
  dedupKey,
  inboundEventName,
} from './kafka.constant';
import { KafkaProducer } from './kafka.producer';
import { KafkaService } from './kafka.service';

/** What is written to the dead-letter topic when a message cannot be handled. */
interface DeadLetterRecord {
  origin: { topic: string; partition: number; offset: string };
  failedAt: string;
  attempts: number;
  error: string;
  key: string | null;
  /** The original message body, verbatim, so it can be replayed as-is. */
  value: string;
}

@Injectable()
export class KafkaConsumer implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(KafkaConsumer.name);
  private readonly groupId: string;
  private consumer?: Consumer;
  // Tracks whether `connect()` succeeded, which is what decides if shutdown
  // still has to disconnect. "Reading messages" is a different thing: the start
  // can fail after connecting, and that connection must still be closed.
  private connected = false;
  private stopped = false;
  private restartTimer?: NodeJS.Timeout;

  constructor(
    private readonly kafka: KafkaService,
    private readonly events: EventEmitter2,
    private readonly producer: KafkaProducer,
    private readonly redis: RedisService,
  ) {
    this.groupId = kafka.groupId;
  }

  /**
   * Joins the consumer group and starts reading every topic.
   *
   * A broker that is down must not stop the worker from starting — the cron
   * jobs and the BullMQ queues do not depend on Kafka — so a failure is logged
   * and retried in the background instead of thrown.
   *
   * @returns Resolves once the consumer runs or the first attempt has failed.
   */
  async onModuleInit(): Promise<void> {
    await this.start();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.restartTimer);
    await this.close();
  }

  /**
   * Connects, subscribes and starts the message loop.
   *
   * Retrying matters more here than anywhere else: a consumer that gave up at
   * boot would leave the worker running and healthy while silently handling
   * nothing.
   *
   * @returns Resolves once the loop runs or a retry has been scheduled.
   */
  private async start(): Promise<void> {
    if (this.stopped) {
      return;
    }

    // A fresh instance per attempt: a consumer that failed to start, or crashed,
    // keeps internal state that reconnecting on the same object would trip over.
    const consumer = this.kafka.createConsumer();
    this.consumer = consumer;

    try {
      // The topic has to exist before subscribing: on an empty cluster the
      // subscription fails instead of waiting for the first message.
      await this.kafka.ensureTopics();
      await consumer.connect();
      this.connected = true;

      await consumer.subscribe({
        // `KafkaTopic` only, never the dead-letter topic: reading it back would
        // hand the failures straight to the handler that already gave up on them.
        topics: Object.values(KafkaTopic),
        // Read the backlog on a first start: an event written while the worker
        // was being deployed still has to be handled.
        fromBeginning: true,
      });

      // `run()` resolves as soon as the loop is started, so nothing after this
      // line would ever notice the loop dying. CRASH is that notification.
      consumer.on(consumer.events.CRASH, (event) => {
        // restart: true means kafkajs restarts the loop itself; false means it
        // gave up, and without this the worker would look healthy while
        // consuming nothing at all.
        if (event.payload.restart) {
          return;
        }
        this.logger.error(
          `The consumer crashed (${event.payload.error.message}), restarting in ${KAFKA_RESTART_DELAY_MS / 1000}s.`,
        );
        void this.close().then(() => this.scheduleRestart());
      });

      await consumer.run({
        eachMessage: (payload) => this.handleMessage(payload),
      });

      this.logger.log(
        `Consuming ${Object.values(KafkaTopic).join(', ')} in group "${this.groupId}".`,
      );
    } catch (error) {
      this.logger.error(
        `Starting the consumer failed (${(error as Error).message}), retrying in ${KAFKA_RESTART_DELAY_MS / 1000}s.`,
      );
      // Connecting may well have succeeded before the failure; leaving that
      // connection open would keep a dead member in the group until the session
      // times out, and would hold the process open on shutdown.
      await this.close();
      this.scheduleRestart();
    }
  }

  /**
   * Disconnects the current consumer, if it ever connected.
   *
   * @returns Resolves once the connection is closed or the failure is logged.
   */
  private async close(): Promise<void> {
    if (!this.connected || !this.consumer) {
      return;
    }
    this.connected = false;

    // Stops after the message in flight, so a rebalance does not cut a handler
    // in half.
    await this.consumer
      .disconnect()
      .catch((error: Error) =>
        this.logger.warn(`Closing the consumer failed: ${error.message}`),
      );
  }

  private scheduleRestart(): void {
    if (this.stopped) {
      return;
    }
    // unref: a pending retry must not keep the process alive on shutdown.
    this.restartTimer = setTimeout(
      () => void this.start(),
      KAFKA_RESTART_DELAY_MS,
    );
    this.restartTimer.unref();
  }

  /**
   * Re-emits one message on the local event bus.
   *
   * Throwing back at kafkajs is not an error path here, it is a stop signal: it
   * refuses the offset and replays the same message forever, blocking every
   * message behind it in the partition. So a message that cannot be handled is
   * retried a few times and then written to the dead-letter topic, where it can
   * be inspected and replayed, and the partition moves on.
   *
   * The one case that DOES throw is a dead-letter write that itself fails —
   * dropping the message then would lose it for good, and a broker that will
   * not accept the dead-letter record will not accept anything, so blocking is
   * the correct outcome rather than a regression.
   *
   * @param payload - Topic, partition and raw message handed over by kafkajs.
   * @returns Resolves once the handlers are done or the message is dead-lettered.
   * @throws {Error} When the message could neither be handled nor dead-lettered.
   */
  private async handleMessage(payload: EachMessagePayload): Promise<void> {
    const { topic, partition, message } = payload;
    const origin = `${topic}[${partition}]@${message.offset}`;
    const raw = message.value?.toString();

    if (!raw) {
      // A tombstone (null value) is a legitimate Kafka message, not a failure;
      // there is nothing to dead-letter.
      this.logger.warn(`${origin}: empty message, skipped.`);
      return;
    }

    let envelope: KafkaEnvelope<unknown>;
    try {
      envelope = JSON.parse(raw) as KafkaEnvelope<unknown>;
    } catch (error) {
      await this.deadLetter(payload, raw, 0, error as Error);
      return;
    }

    if (!envelope?.eventName) {
      await this.deadLetter(
        payload,
        raw,
        0,
        new Error('envelope has no eventName'),
      );
      return;
    }

    // Kafka delivers at least once: a rebalance, an offset that was not
    // committed before a crash, or an outbox row published twice all put the
    // same event on the wire again. Without this the side effects would run
    // twice.
    if (await this.alreadyHandled(envelope.eventId)) {
      this.logger.debug(
        `${origin}: ${envelope.eventName} (event ${envelope.eventId}) already handled, skipped.`,
      );
      return;
    }

    const failure = await this.runHandlers(envelope);

    if (failure) {
      await this.deadLetter(payload, raw, KAFKA_HANDLER_ATTEMPTS, failure);
      return;
    }

    await this.rememberHandled(envelope.eventId);

    // The key, not a field of the payload: the producer keys every message by
    // its aggregate id (the order code), so this line stays right for a topic
    // whose payload this class knows nothing about. Debug level because one
    // line per message is too much for production, and exactly what makes the
    // flow visible while developing.
    this.logger.debug(
      `${origin}: handled ${envelope.eventName} (key ${message.key?.toString() ?? 'none'}).`,
    );
  }

  /**
   * Runs the local handlers, retrying a few times before giving up.
   *
   * Most handler failures are transient — a locked row, a timeout on a call out
   * — and a message that is dead-lettered has to be replayed by hand, so it is
   * worth a couple of immediate retries first.
   *
   * A retry re-emits the event, so EVERY listener of it runs again, including
   * the ones that already succeeded. There is no way around that with a fan-out
   * emit, so a `@OnEvent('kafka.*')` handler has to be idempotent — which it has
   * to be anyway, because Kafka delivers at least once and `eventId` only
   * deduplicates whole messages, not individual listeners.
   *
   * @param envelope - Parsed message.
   * @returns `undefined` on success, otherwise the failure of the last attempt.
   */
  private async runHandlers(
    envelope: KafkaEnvelope<unknown>,
  ): Promise<Error | undefined> {
    let last: Error | undefined;

    for (let attempt = 1; attempt <= KAFKA_HANDLER_ATTEMPTS; attempt++) {
      try {
        // emitAsync, not emit: it waits for the async handlers, so the offset is
        // only committed once they are done.
        await this.events.emitAsync(
          inboundEventName(envelope.eventName),
          envelope.payload,
        );
        return undefined;
      } catch (error) {
        last = error as Error;
        if (attempt < KAFKA_HANDLER_ATTEMPTS) {
          await new Promise((resolve) =>
            setTimeout(resolve, KAFKA_HANDLER_RETRY_DELAY_MS).unref(),
          );
        }
      }
    }

    return last;
  }

  /**
   * Tells whether this group has already run the handlers for an event.
   *
   * Fails open: when Redis is unreachable the message is handled again rather
   * than dropped, because a duplicate side effect is recoverable and a silently
   * discarded event is not.
   *
   * @param eventId - `eventId` from the envelope; absent on a foreign producer.
   * @returns `true` only when the event is known to have been handled.
   */
  private async alreadyHandled(eventId: string | undefined): Promise<boolean> {
    if (!eventId) {
      return false;
    }

    try {
      await this.redis.ensureConnected();
      return (
        (await this.redis.client.exists(dedupKey(this.groupId, eventId))) === 1
      );
    } catch (error) {
      this.logger.warn(
        `Deduplication is unavailable (${(error as Error).message}); handling ${eventId} anyway.`,
      );
      return false;
    }
  }

  /**
   * Records an event as handled, after the handlers succeeded.
   *
   * Written afterwards on purpose: marking it first and then crashing mid-handler
   * would turn a redelivery — the thing that makes the event recoverable — into
   * a message that is skipped and lost.
   *
   * @param eventId - `eventId` from the envelope.
   * @returns Resolves once the marker is stored or the failure is logged.
   */
  private async rememberHandled(eventId: string | undefined): Promise<void> {
    if (!eventId) {
      return;
    }

    try {
      await this.redis.ensureConnected();
      await this.redis.client.set(
        dedupKey(this.groupId, eventId),
        Date.now(),
        'EX',
        KAFKA_DEDUP_TTL_SECONDS,
      );
    } catch (error) {
      // Losing the marker only costs a duplicate on a redelivery that may never
      // come; it is not worth failing the message that was just handled fine.
      this.logger.warn(
        `Could not record ${eventId} as handled: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Parks a message on the dead-letter topic so the partition can move on.
   *
   * @param payload - The message as kafkajs handed it over.
   * @param raw - Original message body, stored verbatim for a replay.
   * @param attempts - How many times the handlers were tried.
   * @param cause - Why the message could not be handled.
   * @returns Resolves once the record is on the dead-letter topic.
   * @throws {Error} `cause`, when the dead-letter write fails too — the offset
   * must not be committed for a message that is now nowhere.
   */
  private async deadLetter(
    { topic, partition, message }: EachMessagePayload,
    raw: string,
    attempts: number,
    cause: Error,
  ): Promise<void> {
    const origin = `${topic}[${partition}]@${message.offset}`;
    const key = message.key?.toString() ?? null;

    const record: DeadLetterRecord = {
      origin: { topic, partition, offset: message.offset },
      failedAt: new Date().toISOString(),
      attempts,
      error: cause.message,
      key,
      value: raw,
    };

    try {
      await this.producer.sendRaw(
        KAFKA_DLQ_TOPIC,
        key ?? message.offset,
        JSON.stringify(record),
      );
      this.logger.error(
        `${origin}: ${cause.message} — moved to ${KAFKA_DLQ_TOPIC} after ${attempts} attempt(s).`,
      );
    } catch (error) {
      this.logger.error(
        `${origin}: ${cause.message}, and writing to ${KAFKA_DLQ_TOPIC} failed too (${(error as Error).message}) — the offset stays put.`,
      );
      throw cause;
    }
  }
}
