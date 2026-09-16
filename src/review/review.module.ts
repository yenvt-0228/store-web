import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProductReviewController } from './product-review.controller';
import { ReviewController } from './review.controller';
import { ReviewService } from './review.service';

@Module({
  imports: [AuthModule],
  controllers: [ProductReviewController, ReviewController],
  providers: [ReviewService],
  exports: [ReviewService],
})
export class ReviewModule {}
