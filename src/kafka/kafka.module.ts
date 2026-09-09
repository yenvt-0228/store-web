import { DynamicModule, Module } from '@nestjs/common';
import { runsBackgroundJobs } from '../common/app-role';
import { KafkaConsumer } from './kafka.consumer';
import { KafkaProducer } from './kafka.producer';
import { KafkaEventPublisher } from './kafka.publisher';
import { KafkaService } from './kafka.service';

export function kafkaEnabled(): boolean {
  return process.env.KAFKA_ENABLED === 'true';
}

/**
 * Wires the Kafka integration.
 *
 * Kafka carries the domain events other services care about; it does not
 * replace BullMQ, which stays the tool for this application's own background
 * jobs (mail, reports) because it has retries, a failed set and a job status.
 */
@Module({})
export class KafkaModule {
  static register(): DynamicModule {
    if (!kafkaEnabled()) {
      return { module: KafkaModule };
    }

    // Same split as MailModule: every process PRODUCES, because the events are
    // emitted while a request is served, but only the background process
    // CONSUMES — an API replica reading the topics would run each handler once
    // per replica.
    const consumes = runsBackgroundJobs();

    return {
      module: KafkaModule,
      providers: [
        KafkaService,
        KafkaProducer,
        KafkaEventPublisher,
        ...(consumes ? [KafkaConsumer] : []),
      ],
      exports: [KafkaProducer],
    };
  }
}
