import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleName } from '../common/constants/role.constant';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { ListSuggestionDto } from './dto/list-suggestion.dto';
import { UpdateSuggestionStatusDto } from './dto/update-suggestion-status.dto';
import { ProductSuggestionService } from './product-suggestion.service';

@ApiTags('admin/product-suggestions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RoleName.ADMIN)
@Controller('admin/product-suggestions')
export class AdminProductSuggestionController {
  constructor(private suggestionService: ProductSuggestionService) {}

  @ApiOperation({ summary: 'Danh sách yêu cầu gợi ý (lọc theo trạng thái)' })
  @Get()
  findAll(@Query() query: ListSuggestionDto) {
    return this.suggestionService.findAll(query);
  }

  @ApiOperation({ summary: 'Chi tiết yêu cầu gợi ý' })
  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return { suggestion: await this.suggestionService.findOne(id) };
  }

  @ApiOperation({ summary: 'Duyệt hoặc từ chối yêu cầu (kèm ghi chú)' })
  @Patch(':id/status')
  async updateStatus(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSuggestionStatusDto,
  ) {
    return {
      suggestion: await this.suggestionService.updateStatus(id, admin.id, dto),
    };
  }
}
