import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateSuggestionDto } from './dto/create-suggestion.dto';
import { ListSuggestionDto } from './dto/list-suggestion.dto';
import { ProductSuggestionService } from './product-suggestion.service';

@ApiTags('product-suggestions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('product-suggestions')
export class ProductSuggestionController {
  constructor(private suggestionService: ProductSuggestionService) {}

  @ApiOperation({ summary: 'Gửi yêu cầu gợi ý sản phẩm mới' })
  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateSuggestionDto,
  ) {
    return { suggestion: await this.suggestionService.create(user.id, dto) };
  }

  @ApiOperation({ summary: 'Yêu cầu gợi ý của tôi' })
  @Get('me')
  findMine(@CurrentUser() user: AuthUser, @Query() query: ListSuggestionDto) {
    return this.suggestionService.findMine(user.id, query);
  }
}
