import { DynamicModule, Module } from '@nestjs/common';
import { runsBackgroundJobs } from '../common/app-role';
import { StatisticsModule } from '../statistics/statistics.module';
import { UploadModule } from '../upload/upload.module';
import { ImageCleanupService } from './image-cleanup.service';
import { RevenueReportService } from './revenue-report.service';
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
      // StatisticsModule is a plain module, so importing it here and in
      // AppModule gives the same instance. The monthly report deliberately
      // reuses the dashboard's definition of revenue rather than aggregating
      // its own — two definitions drift, and then nobody knows which is right.
      imports: [UploadModule, StatisticsModule],
      providers: [
        TokenCleanupService,
        ImageCleanupService,
        RevenueReportService,
      ],
    };
  }
}
