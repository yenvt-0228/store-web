import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Partitioners, type Producer } from 'kafkajs';
import {
  KAFKA_PUBLISH_TIMEOUT_MS,
  KafkaEnvelope,
  KafkaEventName,
} from './kafka.constant';
import { KafkaService } from './kafka.service';

/** One message to publish, before it is wrapped in a {@link KafkaEnvelope}. */
export interface OutboundMessage<T> {
  topic: string;
  /** Partition key; messages sharing a key keep their order. */
  key: string;
  eventName: KafkaEventName;
  payload: T;
  /**
   * Identity of the event, used by consumers to deduplicate.
   *
   * The outbox passes the id of its own row, so a row published twice — the
   * first attempt reached the broker but the process died before the row was
   * marked sent — carries the same id both times and the consumer drops the
   * second copy. Left out, a fresh id is generated.
   */
  eventId?: string;
  occurredAt?: string;
}

@Injectable()
export class KafkaProducer implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(KafkaProducer.name);
  private readonly producer: Producer;
  private connecting?: Promise<void>;
  private connected = false;

  constructor(private readonly kafka: KafkaService) {
    this.producer = kafka.createProducer({
      // Set explicitly: kafkajs warns on every start when it has to fall back
      // to its own default, and the key hashing decides the partition.
      createPartitioner: Partitioners.DefaultPartitioner,
      // The broker deduplicates retried batches, so a network hiccup does not
      // write the same event twice.
      idempotent: true,
      allowAutoTopicCreation: true,
    });
  }

  /**
   * Opens the connection while the application boots.
   *
   * A broker that is down must not stop the process from starting: the first
   * `publish` tries to connect again.
   *
   * @returns Resolves once the connection is open or the failure is logged.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.connect();
      await this.kafka.ensureTopics();
    } catch (error) {
      this.logger.warn(
        `Kafka is not reachable at boot (${(error as Error).message}) — publishing will retry.`,
      );
    }
  }

  /**
   * Publishes one domain event and reports whether it arrived.
   *
   * This used to swallow every failure so a broker outage could not fail the
   * request that produced the event. It no longer has to: nothing publishes
   * from a request anymore. Events are written to the outbox table inside the
   * same transaction as the data that produced them, and the outbox relay is
   * the only caller here — a relay that cannot tell a delivered message from a
   * lost one would mark the row as sent and lose the event for good.
   *
   * @param message - Topic, key, event name and payload to send.
   * @returns Resolves once the broker acknowledged the message.
   * @throws {Error} When the broker refuses the message or stays silent.
   */
  async publish<T>(message: OutboundMessage<T>): Promise<void> {
    const envelope: KafkaEnvelope<T> = {
      eventId: message.eventId ?? randomUUID(),
      eventName: message.eventName,
      occurredAt: message.occurredAt ?? new Date().toISOString(),
      payload: message.payload,
    };

    await this.send(message.topic, message.key, JSON.stringify(envelope));
  }

  /**
   * Sends an already serialized value, for messages that are not domain events.
   *
   * The dead-letter record is the only one: it wraps a message this application
   * failed to handle, so it carries the original envelope rather than being one.
   *
   * @param topic - Topic to write to.
   * @param key - Partition key.
   * @param value - Message body, already a string.
   * @returns Resolves once the broker acknowledged the message.
   * @throws {Error} When the broker refuses the message or stays silent.
   */
  async sendRaw(topic: string, key: string, value: string): Promise<void> {
    await this.send(topic, key, value);
  }

  private async send(topic: string, key: string, value: string): Promise<void> {
    await this.connect();
    // A managed cluster usually has auto-creation disabled, so the first
    // publish would fail on a topic nobody created yet.
    await this.kafka.ensureTopics();
    await this.withTimeout(
      this.producer.send({ topic, messages: [{ key, value }] }),
      KAFKA_PUBLISH_TIMEOUT_MS,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.connected) {
      return;
    }
    this.connected = false;
    await this.producer
      .disconnect()
      .catch((error: Error) =>
        this.logger.warn(`Closing the producer failed: ${error.message}`),
      );
  }

  /**
   * Connects once, even when several publishes race at startup.
   *
   * @returns Resolves when the producer is connected.
   * @throws {Error} When the broker refuses the connection.
   */
  private async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    // Without this shared promise every concurrent publish would open its own
    // connection to the same broker.
    this.connecting ??= this.producer
      .connect()
      .then(() => {
        this.connected = true;
      })
      .finally(() => {
        this.connecting = undefined;
      });

    await this.connecting;
  }

  /**
   * Caps how long an operation may take.
   *
   * @param promise - Operation to race against the deadline.
   * @param ms - Deadline in milliseconds.
   * @returns The settled value of `promise`.
   * @throws {Error} When the deadline passes first.
   */
  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`the broker did not respond within ${ms}ms`)),
          ms,
        ).unref();
      }),
    ]);
  }
}
