import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Consumer, EachMessagePayload } from 'kafkajs';
import { KafkaEnvelope, KafkaTopic, inboundEventName } from './kafka.constant';
import { KafkaService } from './kafka.service';

const RESTART_DELAY_MS = 10_000;

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
    const consumer = this.kafka.client.consumer({ groupId: this.groupId });
    this.consumer = consumer;

    try {
      // The topic has to exist before subscribing: on an empty cluster the
      // subscription fails instead of waiting for the first message.
      await this.kafka.ensureTopics();
      await consumer.connect();
      this.connected = true;

      await consumer.subscribe({
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
          `The consumer crashed (${event.payload.error.message}), restarting in ${RESTART_DELAY_MS / 1000}s.`,
        );
        void this.close().then(() => this.scheduleRestart());
      });

      await consumer.run({
        eachMessage: (payload) => this.handle(payload),
      });

      this.logger.log(
        `Consuming ${Object.values(KafkaTopic).join(', ')} in group "${this.groupId}".`,
      );
    } catch (error) {
      this.logger.error(
        `Starting the consumer failed (${(error as Error).message}), retrying in ${RESTART_DELAY_MS / 1000}s.`,
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
    this.restartTimer = setTimeout(() => void this.start(), RESTART_DELAY_MS);
    this.restartTimer.unref();
  }

  /**
   * Re-emits one message on the local event bus.
   *
   * Throwing here would make kafkajs replay the message forever and block the
   * partition behind it, so both a malformed message and a failing handler are
   * logged and the offset moves on. Anything that must not be lost belongs in a
   * BullMQ job, which does have retries and a failed set.
   *
   * @param payload - Topic, partition and raw message handed over by kafkajs.
   * @returns Resolves once the handlers are done or the failure is logged.
   */
  private async handle({
    topic,
    partition,
    message,
  }: EachMessagePayload): Promise<void> {
    const origin = `${topic}[${partition}]@${message.offset}`;
    const raw = message.value?.toString();

    if (!raw) {
      this.logger.warn(`${origin}: empty message, skipped.`);
      return;
    }

    let envelope: KafkaEnvelope<unknown>;
    try {
      envelope = JSON.parse(raw) as KafkaEnvelope<unknown>;
    } catch (error) {
      this.logger.error(
        `${origin}: message is not valid JSON (${(error as Error).message}), skipped.`,
      );
      return;
    }

    if (!envelope?.eventName) {
      this.logger.error(`${origin}: envelope has no eventName, skipped.`);
      return;
    }

    try {
      // emitAsync, not emit: it waits for the async handlers, so the offset is
      // only committed once they are done.
      await this.events.emitAsync(
        inboundEventName(envelope.eventName),
        envelope.payload,
      );

      // The key, not a field of the payload: the producer keys every message by
      // its aggregate id (the order code), so this line stays right for a topic
      // whose payload this class knows nothing about. Debug level because one
      // line per message is too much for production, and exactly what makes the
      // flow visible while developing.
      this.logger.debug(
        `${origin}: handled ${envelope.eventName} (key ${message.key?.toString() ?? 'none'}).`,
      );
    } catch (error) {
      this.logger.error(
        `${origin}: handling ${envelope.eventName} failed: ${(error as Error).message}`,
      );
    }
  }
}
