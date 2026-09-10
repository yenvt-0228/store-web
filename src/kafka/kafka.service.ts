import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Kafka,
  logLevel,
  type Admin,
  type Consumer,
  type LogEntry,
  type Producer,
  type ProducerConfig,
  type SASLOptions,
} from 'kafkajs';
import {
  KAFKA_DEFAULT_BROKERS,
  KAFKA_DEFAULT_CLIENT_ID,
  KAFKA_DEFAULT_GROUP_ID,
  KAFKA_DEFAULT_PARTITIONS,
  KAFKA_DEFAULT_REPLICATION_FACTOR,
  KAFKA_MANAGED_TOPICS,
  KAFKA_SASL_MECHANISMS,
  type KafkaSaslMechanism,
} from './kafka.constant';

/**
 * Owns the shared `Kafka` client: the producer and the consumer both build
 * themselves from it, so brokers and credentials are read in one place only.
 *
 * The client itself stays private — callers ask for a producer or a consumer
 * and get one configured the same way every time, instead of reaching into the
 * kafkajs API from three different files.
 */
@Injectable()
export class KafkaService {
  private readonly logger = new Logger(KafkaService.name);
  private readonly client: Kafka;
  private topicsReady?: Promise<void>;

  constructor(private readonly config: ConfigService) {
    this.client = new Kafka({
      clientId:
        this.config.get<string>('KAFKA_CLIENT_ID') ?? KAFKA_DEFAULT_CLIENT_ID,
      brokers: this.brokers,
      ssl: this.config.get<string>('KAFKA_SSL') === 'true',
      sasl: this.sasl,
      // kafkajs writes structured JSON straight to stdout by default, which
      // does not match the rest of the logs; route it through Nest instead.
      logCreator: () => (entry: LogEntry) => this.log(entry),
    });
  }

  /**
   * The consumer group this process joins.
   *
   * Every replica shares one group so a partition is handled by a single
   * process: two groups would each get a full copy of every message and run the
   * side effects twice.
   */
  get groupId(): string {
    return this.config.get<string>('KAFKA_GROUP_ID') ?? KAFKA_DEFAULT_GROUP_ID;
  }

  /**
   * Builds a producer on the shared client.
   *
   * @param config - Producer options that differ per caller.
   * @returns A producer that still has to be connected.
   */
  createProducer(config: ProducerConfig): Producer {
    return this.client.producer(config);
  }

  /**
   * Builds a consumer in {@link groupId} on the shared client.
   *
   * @returns A consumer that still has to be connected.
   */
  createConsumer(): Consumer {
    return this.client.consumer({ groupId: this.groupId });
  }

  /**
   * Creates the topics that do not exist yet, once per process.
   *
   * Subscribing to a topic that was never written to fails with "this server
   * does not host this topic-partition", so the consumer cannot simply wait for
   * the first publish to auto-create it. Creating them up front also fixes the
   * partition count instead of leaving it to the broker default.
   *
   * @returns Resolves once every topic exists.
   * @throws {Error} When the broker is unreachable or refuses the creation.
   */
  async ensureTopics(): Promise<void> {
    // A failed attempt clears the cache so the caller that retries actually
    // tries again instead of awaiting the same rejected promise forever.
    this.topicsReady ??= this.createTopics().catch((error: Error) => {
      this.topicsReady = undefined;
      throw error;
    });

    await this.topicsReady;
  }

  private async createTopics(): Promise<void> {
    const admin: Admin = this.client.admin();
    await admin.connect();

    try {
      // Asking for a topic that exists is answered with a protocol error that
      // kafkajs logs at error level on every boot; listing first keeps the logs
      // of a normal start clean.
      const existing = await admin.listTopics();
      const missing = KAFKA_MANAGED_TOPICS.filter(
        (topic) => !existing.includes(topic),
      );

      if (missing.length === 0) {
        return;
      }

      await admin.createTopics({
        topics: missing.map((topic) => ({
          topic,
          numPartitions: this.number(
            'KAFKA_TOPIC_PARTITIONS',
            KAFKA_DEFAULT_PARTITIONS,
          ),
          replicationFactor: this.number(
            'KAFKA_TOPIC_REPLICATION_FACTOR',
            KAFKA_DEFAULT_REPLICATION_FACTOR,
          ),
        })),
        // Producing to a partition with no leader yet fails, so wait for the
        // election rather than racing it.
        waitForLeaders: true,
      });

      this.logger.log(`Created topics: ${missing.join(', ')}.`);
    } finally {
      // Not rethrown: this runs in a `finally`, so throwing here would replace
      // the real failure of `createTopics` with the failure of a cleanup step
      // and hide why the topics could not be created. Logged rather than
      // swallowed, because an admin client that will not close is a leaked
      // connection somebody has to know about.
      await admin
        .disconnect()
        .catch((error: Error) =>
          this.logger.warn(`Closing the Kafka admin failed: ${error.message}`),
        );
    }
  }

  private number(key: string, fallback: number): number {
    const value = Number(this.config.get<string>(key));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  private get brokers(): string[] {
    const raw =
      this.config.get<string>('KAFKA_BROKERS') || KAFKA_DEFAULT_BROKERS;
    return raw
      .split(',')
      .map((broker) => broker.trim())
      .filter(Boolean);
  }

  private get sasl(): SASLOptions | undefined {
    const username = this.config.get<string>('KAFKA_SASL_USERNAME');
    const password = this.config.get<string>('KAFKA_SASL_PASSWORD');

    // A local broker runs without authentication; only managed clusters
    // (Confluent, Redpanda Cloud, MSK) set credentials.
    if (!username || !password) {
      return undefined;
    }

    const mechanism = (
      this.config.get<string>('KAFKA_SASL_MECHANISM') ?? 'plain'
    ).toLowerCase();

    if (!KAFKA_SASL_MECHANISMS.includes(mechanism as KafkaSaslMechanism)) {
      throw new Error(
        `KAFKA_SASL_MECHANISM="${mechanism}" is not valid — expected one of: ${KAFKA_SASL_MECHANISMS.join(', ')}.`,
      );
    }

    return { mechanism, username, password } as SASLOptions;
  }

  /**
   * Bridges a kafkajs log entry to the Nest logger.
   *
   * @param entry - Level, namespace and message produced by kafkajs.
   */
  private log({ level, namespace, log }: LogEntry): void {
    // kafkajs puts the useful part (the broker error) next to the message, so
    // logging `log.message` alone would hide why a request failed.
    const detail = typeof log.error === 'string' ? ` — ${log.error}` : '';
    const message = `[${namespace}] ${log.message}${detail}`;

    if (level === logLevel.ERROR || level === logLevel.NOTHING) {
      this.logger.error(message);
      return;
    }
    if (level === logLevel.WARN) {
      this.logger.warn(message);
      return;
    }
    this.logger.debug(message);
  }
}
