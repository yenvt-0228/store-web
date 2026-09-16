import { PartialType } from '@nestjs/swagger';
import { CreateReviewDto } from './create-review.dto';

// Sửa đánh giá thì cả `rating` lẫn `content` đều tuỳ chọn, nhưng luật của từng
// trường (1..5, dài tối đa 2000) giữ nguyên.
export class UpdateReviewDto extends PartialType(CreateReviewDto) {}
