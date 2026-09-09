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
