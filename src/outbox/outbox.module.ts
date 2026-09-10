import { Module } from '@nestjs/common';
import { OutboxService } from './outbox.service';

/**
 * Provides the write side of the outbox.
 *
 * The read side (`OutboxRelay`) lives in `KafkaModule` instead: it is the only
 * thing that talks to a broker, and it must only run in the worker process.
 */
@Module({
  providers: [OutboxService],
  exports: [OutboxService],
})
export class OutboxModule {}
