import { DynamicModule, Module } from '@nestjs/common';
import { runsBackgroundJobs } from '../common/app-role';
import { UploadModule } from '../upload/upload.module';
import { ImageCleanupService } from './image-cleanup.service';
import { TokenCleanupService } from './token-cleanup.service';

@Module({})
export class TasksModule {
  // Cron is only registered in the process that runs background work. If the
  // API process (or each of its replicas) registered it too, the same cleanup
  // would run several times at 3am/4am.
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
