import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ListProductDto } from './dto/list-product.dto';
import { ProductShareService } from './product-share.service';
import { ProductService } from './product.service';

@ApiTags('products')
@Controller('products')
export class ProductController {
  constructor(
    private productService: ProductService,
    private shareService: ProductShareService,
  ) {}

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

  @ApiOperation({ summary: 'Thông tin chia sẻ MXH (Open Graph, Twitter card)' })
  @Get(':id/share')
  share(@Param('id', ParseUUIDPipe) id: string) {
    return this.shareService.shareInfo(id);
  }
}
