import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PaginationDto } from '../common/dto/pagination.dto';
import { CreateReviewDto } from './dto/create-review.dto';
import { ReviewService } from './review.service';

/**
 * Đánh giá xét theo sản phẩm. Sửa và xoá nằm ở `ReviewController` vì chúng chỉ
 * cần id của đánh giá — nhét vào đây thì đường dẫn mang một productId mà không
 * ai dùng tới, và không ai bắt nó phải khớp với đánh giá cả.
 */
@ApiTags('reviews')
@Controller('products/:productId/reviews')
export class ProductReviewController {
  constructor(private reviewService: ReviewService) {}

  @ApiOperation({ summary: 'Đánh giá của một sản phẩm (kèm điểm trung bình)' })
  @Get()
  findAll(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Query() query: PaginationDto,
  ) {
    return this.reviewService.findAll(productId, query);
  }

  @ApiOperation({ summary: 'Đánh giá sản phẩm (chỉ khi đã mua)' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: CreateReviewDto,
  ) {
    return {
      review: await this.reviewService.create(user.id, productId, dto),
    };
  }
}
