import { Module } from '@nestjs/common';
import { UploadModule } from '../upload/upload.module';
import { ImageCleanupService } from './image-cleanup.service';
import { TokenCleanupService } from './token-cleanup.service';

@Module({
  imports: [UploadModule],
  providers: [TokenCleanupService, ImageCleanupService],
})
export class TasksModule {}
