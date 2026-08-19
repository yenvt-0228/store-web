import { Module } from '@nestjs/common';
import { TokenCleanupService } from './token-cleanup.service';

@Module({
  providers: [TokenCleanupService],
})
export class TasksModule {}
