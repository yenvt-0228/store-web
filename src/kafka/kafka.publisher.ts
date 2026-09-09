import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type {
  OrderConfirmedEvent,
  OrderCreatedEvent,
  OrderRejectedEvent,
} from '../common/events/order.event';
import { OrderEvent } from '../common/events/order.event';
import { KafkaEventName, KafkaTopic } from './kafka.constant';
import { KafkaProducer } from './kafka.producer';

/**
 * Mirrors the in-process domain events onto Kafka.
 *
 * The services keep emitting on the local bus and know nothing about Kafka, so
 * turning `KAFKA_ENABLED` off removes the whole integration without touching a
 * single service.
 *
 * Only order events are mirrored on purpose: the mail events carry activation
 * and password-reset tokens, and a topic other services read is the wrong place
 * for a credential.
 */
@Injectable()
export class KafkaEventPublisher {
  constructor(private readonly producer: KafkaProducer) {}

  @OnEvent(OrderEvent.CREATED)
  async onOrderCreated(event: OrderCreatedEvent): Promise<void> {
    await this.producer.publish(
      KafkaTopic.ORDER,
      event.orderCode,
      KafkaEventName.ORDER_CREATED,
      event,
    );
  }

  @OnEvent(OrderEvent.CONFIRMED)
  async onOrderConfirmed(event: OrderConfirmedEvent): Promise<void> {
    await this.producer.publish(
      KafkaTopic.ORDER,
      event.orderCode,
      KafkaEventName.ORDER_CONFIRMED,
      event,
    );
  }

  @OnEvent(OrderEvent.REJECTED)
  async onOrderRejected(event: OrderRejectedEvent): Promise<void> {
    await this.producer.publish(
      KafkaTopic.ORDER,
      event.orderCode,
      KafkaEventName.ORDER_REJECTED,
      event,
    );
  }
}
