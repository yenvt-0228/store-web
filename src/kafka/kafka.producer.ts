import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Partitioners, type Producer } from 'kafkajs';
import { KafkaEnvelope, KafkaEventName, KafkaTopic } from './kafka.constant';
import { KafkaService } from './kafka.service';

const PUBLISH_TIMEOUT_MS = 3000;

@Injectable()
export class KafkaProducer implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(KafkaProducer.name);
  private readonly producer: Producer;
  private connecting?: Promise<void>;
  private connected = false;

  constructor(private readonly kafka: KafkaService) {
    this.producer = kafka.client.producer({
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
   * Publishes a domain event.
   *
   * Kafka is a side channel here, not the source of truth: a broker outage must
   * not fail the request that produced the event, so a failure is logged and
   * swallowed instead of thrown.
   *
   * @param topic - Topic to write to.
   * @param key - Partition key; messages sharing a key keep their order.
   * @param eventName - Name stored in the envelope, used for routing.
   * @param payload - Event body, serialized as JSON.
   * @returns Resolves whether or not the message reached the broker.
   */
  async publish<T>(
    topic: KafkaTopic,
    key: string,
    eventName: KafkaEventName,
    payload: T,
  ): Promise<void> {
    const envelope: KafkaEnvelope<T> = {
      eventId: randomUUID(),
      eventName,
      occurredAt: new Date().toISOString(),
      payload,
    };

    try {
      await this.connect();
      // A managed cluster usually has auto-creation disabled, so the first
      // publish would fail on a topic nobody created yet.
      await this.kafka.ensureTopics();
      await this.withTimeout(
        this.producer.send({
          topic,
          messages: [{ key, value: JSON.stringify(envelope) }],
        }),
        PUBLISH_TIMEOUT_MS,
      );
    } catch (error) {
      this.logger.error(
        `Publishing ${eventName} (key ${key}) to ${topic} failed: ${(error as Error).message}`,
      );
    }
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
