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
  /**
   * DynamicModule đã dựng, dùng chung cho mọi nơi import.
   *
   * Nest định danh module ĐỘNG theo *tham chiếu object*, không theo nội dung
   * metadata: `ByReferenceModuleOpaqueKeyFactory` (mặc định từ Nest 11) đóng một
   * id ngẫu nhiên lên chính object rồi nhớ id đó trên object. Hai lần gọi
   * `register()` trả về hai object khác nhau, nên Nest coi là hai module khác
   * nhau dù metadata giống hệt.
   *
   * Module này bị import ở hai nơi — `AppModule` và `GrpcModule` (cho
   * `WatchReport`) — nên nếu không nhớ lại thì mọi thứ bên trong bị dựng hai
   * bản. Hậu quả nặng nhất không phải `ReportController` thừa mà là
   * `ReportProcessor`: với `APP_ROLE=all`, hai BullMQ worker cùng rút việc từ
   * một hàng đợi trong cùng một process, mỗi bản ôm thêm một bộ kết nối Redis.
   *
   * Cố ý không có hàm reset: cấu hình đọc từ biến môi trường, mà biến môi
   * trường thì không đổi giữa chừng trong một process.
   */
  private static cached?: DynamicModule;

  static register(): DynamicModule {
    ReportModule.cached ??= ReportModule.build();
    return ReportModule.cached;
  }

  private static build(): DynamicModule {
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
  }
}
