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

    // Same as MailModule: the API process only pushes jobs, the background
    // process is the one that builds the file.
    const consumesJobs = queueEnabled && runsBackgroundJobs();

    return {
      module: ReportModule,
      imports: [
        AuthModule,
        // UploadModule in every role: the API process needs StorageService to
        // serve the download endpoint, not just the worker to upload.
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
