import { BullModule } from '@nestjs/bullmq';
import { DynamicModule, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { runsBackgroundJobs } from '../common/app-role';
import { registerOnce } from '../common/utils/dynamic-module.util';
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
  /**
   * Module này là lý do `registerOnce` tồn tại: nó bị import ở HAI nơi —
   * `AppModule` và `GrpcModule` (cho rpc `WatchReport`) — nên nếu không nhớ
   * lại thì mọi thứ bên trong bị dựng hai bản. Hậu quả nặng nhất không phải
   * `ReportController` thừa mà là `ReportProcessor`: với `APP_ROLE=all`, hai
   * BullMQ worker cùng rút việc từ một hàng đợi trong cùng một process, mỗi
   * bản ôm thêm một bộ kết nối Redis.
   */
  static readonly register = registerOnce((): DynamicModule => {
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
      // Exported for the gRPC WatchReport stream, which follows the same job
      // through the same service the REST status endpoint uses.
      exports: [ReportService],
    };
  });
}
