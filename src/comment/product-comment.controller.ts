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
import { CommentService } from './comment.service';
import { CreateCommentDto } from './dto/create-comment.dto';

@ApiTags('comments')
@Controller('products/:productId/comments')
export class ProductCommentController {
  constructor(private commentService: CommentService) {}

  @ApiOperation({ summary: 'Bình luận của một sản phẩm' })
  @Get()
  findAll(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Query() query: PaginationDto,
  ) {
    return this.commentService.findAll(productId, query);
  }

  @ApiOperation({ summary: 'Thêm bình luận' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: CreateCommentDto,
  ) {
    return {
      comment: await this.commentService.create(user.id, productId, dto),
    };
  }
}
