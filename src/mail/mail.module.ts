import { BullModule } from '@nestjs/bullmq';
import { DynamicModule, Module } from '@nestjs/common';
import { runsBackgroundJobs } from '../common/app-role';
import { mailQueueEnabled } from '../queue/queue.module';
import { MAIL_QUEUE } from './mail.constant';
import { MailDispatcher } from './mail.dispatcher';
import { MailListener } from './mail.listener';
import { MailProcessor } from './mail.processor';
import { MailRenderer } from './mail.renderer';
import { MailService } from './mail.service';

@Module({})
export class MailModule {
  static register(): DynamicModule {
    const queueEnabled = mailQueueEnabled();

    // When the queue is on every process needs the Queue to PUSH jobs
    // (MailDispatcher), but only the background process CONSUMES them. If the
    // API ran the processor too, splitting the worker out would take no load
    // off the process serving requests.
    const consumesJobs = queueEnabled && runsBackgroundJobs();

    return {
      module: MailModule,
      imports: queueEnabled
        ? [BullModule.registerQueue({ name: MAIL_QUEUE })]
        : [],
      providers: [
        MailService,
        MailDispatcher,
        MailRenderer,
        MailListener,
        ...(consumesJobs ? [MailProcessor] : []),
      ],
      exports: [MailDispatcher],
    };
  }
}
