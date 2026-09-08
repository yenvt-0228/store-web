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

    // Queue bật thì process nào cũng cần Queue để ĐẨY job (MailDispatcher), nhưng
    // chỉ process việc nền mới TIÊU THỤ. Nếu API cũng chạy processor thì tách
    // worker ra không giảm được tải gì cho tiến trình phục vụ request.
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
