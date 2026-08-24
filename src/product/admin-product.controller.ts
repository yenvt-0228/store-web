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
import { RolesGuard } from '../common/guards/roles.guard';
import { CreateProductDto } from './dto/create-product.dto';
import { ListProductDto } from './dto/list-product.dto';
import {
  AddProductImagesDto,
  UpdateProductImageDto,
} from './dto/product-image.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductService } from './product.service';

@ApiTags('admin/products')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RoleName.ADMIN)
@Controller('admin/products')
export class AdminProductController {
  constructor(private productService: ProductService) {}

  @ApiOperation({ summary: 'Danh sách sản phẩm (kể cả đang ẩn)' })
  @Get()
  findAll(@Query() query: ListProductDto) {
    return this.productService.findAll(query, false);
  }

  @ApiOperation({ summary: 'Chi tiết sản phẩm' })
  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return { product: await this.productService.findOne(id, false) };
  }

  @ApiOperation({ summary: 'Tạo sản phẩm' })
  @Post()
  async create(@Body() dto: CreateProductDto) {
    return { product: await this.productService.create(dto) };
  }

  @ApiOperation({ summary: 'Sửa sản phẩm' })
  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return { product: await this.productService.update(id, dto) };
  }

  @ApiOperation({ summary: 'Xoá mềm sản phẩm' })
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.productService.remove(id);
  }

  /* ẢNH */

  @ApiOperation({ summary: 'Thêm ảnh cho sản phẩm (nhận URL, tối đa 10 ảnh)' })
  @Post(':id/images')
  async addImages(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddProductImagesDto,
  ) {
    return { product: await this.productService.addImages(id, dto.images) };
  }

  @ApiOperation({ summary: 'Đổi thứ tự ảnh hoặc đặt làm ảnh chính' })
  @Patch(':id/images/:imageId')
  async updateImage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @Body() dto: UpdateProductImageDto,
  ) {
    return {
      product: await this.productService.updateImage(id, imageId, dto),
    };
  }

  @ApiOperation({ summary: 'Xoá một ảnh khỏi sản phẩm' })
  @Delete(':id/images/:imageId')
  removeImage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
  ) {
    return this.productService.removeImage(id, imageId);
  }
}
