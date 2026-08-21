import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ListProductDto } from './dto/list-product.dto';
import { ProductService } from './product.service';

@ApiTags('products')
@Controller('products')
export class ProductController {
  constructor(private productService: ProductService) {}

  @ApiOperation({ summary: 'Danh sách sản phẩm (tìm kiếm, lọc, sắp xếp)' })
  @Get()
  findAll(@Query() query: ListProductDto) {
    return this.productService.findAll(query, true);
  }
  @ApiOperation({ summary: 'Sản phẩm nổi bật' })
  @Get('featured')
  findFeatured(@Query() query: ListProductDto) {
    return this.productService.findFeatured(query.limit);
  }

  @ApiOperation({ summary: 'Chi tiết sản phẩm' })
  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return { product: await this.productService.findOne(id, true) };
  }
}
