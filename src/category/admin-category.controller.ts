import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleName } from '../common/constants/role.constant';
import { Roles } from '../common/decorators/roles.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { RolesGuard } from '../common/guards/roles.guard';
import { CategoryService } from './category.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@ApiTags('admin/categories')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RoleName.ADMIN)
@Controller('admin/categories')
export class AdminCategoryController {
  constructor(private categoryService: CategoryService) {}

  @ApiOperation({ summary: 'Danh sách danh mục' })
  @Get()
  findAll(@Query() query: PaginationDto) {
    return this.categoryService.findAll(query);
  }

  @ApiOperation({ summary: 'Chi tiết danh mục' })
  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return { category: await this.categoryService.findOne(id) };
  }

  @ApiOperation({ summary: 'Tạo danh mục' })
  @Post()
  async create(@Body() dto: CreateCategoryDto) {
    return { category: await this.categoryService.create(dto) };
  }

  @ApiOperation({ summary: 'Sửa danh mục' })
  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return { category: await this.categoryService.update(id, dto) };
  }

  @ApiOperation({ summary: 'Xoá danh mục (chỉ khi không còn sản phẩm)' })
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.categoryService.remove(id);
  }
}
