import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaginationDto } from '../common/dto/pagination.dto';
import { ListProductDto } from '../product/dto/list-product.dto';
import { ProductService } from '../product/product.service';
import { CategoryService } from './category.service';

/**
 * Danh mục cho khách chưa đăng nhập.
 *
 * Không guard: đây là dữ liệu điều hướng của cửa hàng, khách vào xem hàng phải
 * thấy được. Bản `/admin/categories` vẫn là nơi duy nhất sửa được.
 */
@ApiTags('categories')
@Controller('categories')
export class CategoryController {
  constructor(
    private categoryService: CategoryService,
    private productService: ProductService,
  ) {}

  @ApiOperation({ summary: 'Danh sách danh mục' })
  @Get()
  findAll(@Query() query: PaginationDto) {
    return this.categoryService.findAll(query);
  }

  @ApiOperation({ summary: 'Sản phẩm thuộc một danh mục' })
  @Get(':id/products')
  async findProducts(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListProductDto,
  ) {
    // Danh mục không tồn tại phải là 404, không phải một trang rỗng: "không có
    // sản phẩm nào" và "không có danh mục này" là hai câu trả lời khác nhau.
    await this.categoryService.findOne(id);

    // Gán thẳng lên DTO chứ KHÔNG `{ ...query, categoryId: id }`: spread trả về
    // object thuần, mất prototype, và `skip` là một getter trên prototype của
    // PaginationDto — sao chép xong thì phân trang im lặng hỏng.
    query.categoryId = id;

    // publicOnly = true: khách thấy đúng những gì /products cho thấy. Đường dẫn
    // là thứ quyết định danh mục, nên nó ghi đè categoryId client gửi kèm.
    return this.productService.findAll(query, true);
  }
}
