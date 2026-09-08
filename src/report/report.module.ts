import { BullModule } from '@nestjs/bullmq';
import { DynamicModule, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { runsBackgroundJobs } from '../common/app-role';
import { reportQueueEnabled } from '../queue/queue.module';
import { UploadModule } from '../upload/upload.module';
import { OrderReportSource } from './order-report.source';
import { REPORT_QUEUE } from './report.constant';
import { ReportController } from './report.controller';
import { ReportProcessor } from './report.processor';
import { ReportService } from './report.service';
import { XlsxThreadRunner } from './xlsx-thread.runner';

@Module({})
export class ReportModule {
  static register(): DynamicModule {
    const queueEnabled = reportQueueEnabled();

    // Giống MailModule: process API chỉ đẩy job, process việc nền mới dựng file.
    const consumesJobs = queueEnabled && runsBackgroundJobs();

    return {
      module: ReportModule,
      imports: [
        AuthModule,
        // UploadModule ở mọi role: process API cần StorageService để phục vụ
        // endpoint download, không chỉ worker cần để đẩy file lên.
        UploadModule,
        ...(queueEnabled
          ? [BullModule.registerQueue({ name: REPORT_QUEUE })]
          : []),
      ],
      controllers: [ReportController],
      providers: [
        ReportService,
        ...(consumesJobs
          ? [ReportProcessor, OrderReportSource, XlsxThreadRunner]
          : []),
      ],
    };
  }
}
