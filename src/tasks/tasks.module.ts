import { DynamicModule, Module } from '@nestjs/common';
import { runsBackgroundJobs } from '../common/app-role';
import { UploadModule } from '../upload/upload.module';
import { ImageCleanupService } from './image-cleanup.service';
import { TokenCleanupService } from './token-cleanup.service';

@Module({})
export class TasksModule {
  // Cron chỉ đăng ký ở process chạy việc nền. Process API (hoặc mỗi replica của nó)
  // cũng đăng ký thì cùng một lệnh dọn dữ liệu chạy nhiều lần vào 3h/4h sáng.
  static register(): DynamicModule {
    if (!runsBackgroundJobs()) {
      return { module: TasksModule };
    }

    return {
      module: TasksModule,
      imports: [UploadModule],
      providers: [TokenCleanupService, ImageCleanupService],
    };
  }
}
