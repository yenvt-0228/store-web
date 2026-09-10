/**
 * Topics the application produces to and consumes from.
 *
 * One topic per aggregate rather than one per event: every message about the
 * same order carries the order code as its key, so Kafka keeps them in the same
 * partition and a consumer never sees `order.confirmed` before `order.created`.
 */
export const KafkaTopic = {
  ORDER: 'store.order.events',
} as const;

export type KafkaTopic = (typeof KafkaTopic)[keyof typeof KafkaTopic];

/**
 * Where a message goes when its handlers keep failing.
 *
 * Deliberately NOT part of `KafkaTopic`: the consumer subscribes to every value
 * of that object, and subscribing to the dead-letter topic would feed the
 * failures straight back into the handler that could not process them.
 */
export const KAFKA_DLQ_TOPIC = 'store.dlq';

// Topics `ensureTopics()` creates. The dead-letter topic has to exist before
// the first message fails, not after.
export const KAFKA_MANAGED_TOPICS: readonly string[] = [
  ...Object.values(KafkaTopic),
  KAFKA_DLQ_TOPIC,
];

// Event names travel inside the envelope, so one topic can carry several kinds
// of message. They mirror the local event names in `common/events`.
export const KafkaEventName = {
  ORDER_CREATED: 'order.created',
  ORDER_CONFIRMED: 'order.confirmed',
  ORDER_REJECTED: 'order.rejected',
} as const;

export type KafkaEventName =
  (typeof KafkaEventName)[keyof typeof KafkaEventName];

/**
 * Wrapper around every published payload.
 *
 * Consumers (this application, or another service) need to know what they are
 * reading and when it happened without parsing the payload, and `eventId` gives
 * them something to deduplicate on: Kafka delivers at least once, so the same
 * message can arrive twice after a rebalance.
 */
export interface KafkaEnvelope<T> {
  eventId: string;
  eventName: KafkaEventName;
  occurredAt: string;
  payload: T;
}

// Consumed messages are re-emitted on the local event bus under this prefix
// (`kafka.order.created`). Without it a handler would fire on the local event
// AND on the Kafka message it produced, doubling every side effect.
export const KAFKA_INBOUND_PREFIX = 'kafka';

/**
 * Builds the local event name a consumed Kafka message is re-emitted under.
 *
 * @param eventName - Event name read from the message envelope.
 * @returns The prefixed name to listen for with `@OnEvent`.
 */
export function inboundEventName(eventName: string): string {
  return `${KAFKA_INBOUND_PREFIX}.${eventName}`;
}

/**
 * Redis key that marks one event as already handled by one consumer group.
 *
 * Scoped by group on purpose: two groups are two independent readers of the
 * same topic, and one of them handling a message says nothing about the other.
 *
 * @param groupId - Consumer group that handled the message.
 * @param eventId - `eventId` from the message envelope.
 * @returns The key to `SET ... NX` before running the handlers.
 */
export function dedupKey(groupId: string, eventId: string): string {
  return `kafka:handled:${groupId}:${eventId}`;
}

// --- Client configuration defaults -----------------------------------------

export const KAFKA_DEFAULT_BROKERS = 'localhost:9092';
export const KAFKA_DEFAULT_CLIENT_ID = 'store-web';
export const KAFKA_DEFAULT_GROUP_ID = 'store-web-api';
export const KAFKA_DEFAULT_PARTITIONS = 3;
export const KAFKA_DEFAULT_REPLICATION_FACTOR = 1;

export const KAFKA_SASL_MECHANISMS = [
  'plain',
  'scram-sha-256',
  'scram-sha-512',
] as const;

export type KafkaSaslMechanism = (typeof KAFKA_SASL_MECHANISMS)[number];

// --- Timings ---------------------------------------------------------------

// A publish that hangs would hold the outbox relay for as long as the broker
// stays silent; failing fast lets the next tick retry.
export const KAFKA_PUBLISH_TIMEOUT_MS = 3_000;

export const KAFKA_RESTART_DELAY_MS = 10_000;

// Attempts per message before it is dead-lettered, and the pause between them.
// A handler usually fails on something transient (a locked row, a timeout), so
// a couple of immediate retries save most messages.
export const KAFKA_HANDLER_ATTEMPTS = 3;
export const KAFKA_HANDLER_RETRY_DELAY_MS = 500;

// How long a handled `eventId` is remembered. It only has to outlive a redelivery
// (rebalance, offset reset, an outbox row published twice), not the event itself.
export const KAFKA_DEDUP_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Whether the Kafka integration is wired at all.
 *
 * Read from the environment rather than injected: it decides what a module
 * registers, which happens before any provider exists. It lives here rather
 * than in `kafka.module` so the outbox can ask without importing the module
 * that imports the outbox.
 *
 * @returns `true` when `KAFKA_ENABLED` is exactly `"true"`.
 */
export function kafkaEnabled(): boolean {
  return process.env.KAFKA_ENABLED === 'true';
}
