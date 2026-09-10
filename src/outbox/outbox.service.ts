import { Injectable } from '@nestjs/common';
import { KafkaEventName, kafkaEnabled } from '../kafka/kafka.constant';
import { Prisma } from '../generated/prisma/client';

/** One domain event to publish once the surrounding transaction commits. */
export interface OutboxRecord<T> {
  topic: string;
  /** Aggregate id — the order code — so Kafka keeps one order's events ordered. */
  key: string;
  eventName: KafkaEventName;
  payload: T;
}

/**
 * Writes domain events to the outbox table.
 *
 * The point is that this takes the caller's transaction client rather than the
 * Prisma service: the event row and the data that produced it are committed
 * together or not at all. Publishing straight to Kafka from the service was the
 * bug this replaces — the order was committed, the broker was unreachable, and
 * the event was gone with only a log line to show for it.
 */
@Injectable()
export class OutboxService {
  /**
   * Queues an event inside the caller's transaction.
   *
   * @param tx - The transaction the event belongs to; NOT the plain client.
   * @param event - Topic, key, name and payload of the event.
   * @returns Resolves once the row is part of the transaction.
   */
  async record<T>(
    tx: Prisma.TransactionClient,
    event: OutboxRecord<T>,
  ): Promise<void> {
    // Without a relay to drain them the rows would only pile up, so an
    // installation that runs without Kafka writes none.
    if (!kafkaEnabled()) {
      return;
    }

    await tx.outboxEvent.create({
      data: {
        topic: event.topic,
        eventKey: event.key,
        eventName: event.eventName,
        payload: event.payload as Prisma.InputJsonValue,
      },
    });
  }
}
