import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CommentController } from './comment.controller';
import { CommentService } from './comment.service';
import { ProductCommentController } from './product-comment.controller';

@Module({
  imports: [AuthModule],
  controllers: [ProductCommentController, CommentController],
  providers: [CommentService],
  exports: [CommentService],
})
export class CommentModule {}
