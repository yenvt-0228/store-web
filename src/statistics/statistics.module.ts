import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminStatisticsController } from './admin-statistics.controller';
import { StatisticsService } from './statistics.service';

@Module({
  imports: [AuthModule],
  controllers: [AdminStatisticsController],
  providers: [StatisticsService],
  // Export để cron báo cáo doanh thu cuối tháng dùng lại đúng định nghĩa doanh
  // thu này, thay vì tự gộp một kiểu khác rồi ra con số lệch với dashboard.
  exports: [StatisticsService],
})
export class StatisticsModule {}
