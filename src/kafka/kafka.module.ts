import { DynamicModule, Module } from '@nestjs/common';
import { runsBackgroundJobs } from '../common/app-role';
import { OutboxRelay } from '../outbox/outbox.relay';
import { KafkaConsumer } from './kafka.consumer';
import { kafkaEnabled } from './kafka.constant';
import { KafkaProducer } from './kafka.producer';
import { KafkaService } from './kafka.service';

export { kafkaEnabled };

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

    // The API process talks to no broker at all any more. It used to hold a
    // producer because events were published from the request that raised them;
    // now a request only writes an outbox row, and the relay in the background
    // process is what puts it on a topic. Running the relay in an API replica
    // as well would publish the same rows a second time and out of order, and
    // consuming there would run every handler once per replica.
    if (!runsBackgroundJobs()) {
      return { module: KafkaModule };
    }

    return {
      module: KafkaModule,
      providers: [KafkaService, KafkaProducer, OutboxRelay, KafkaConsumer],
      exports: [KafkaProducer],
    };
  }
}
