import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProductModule } from '../product/product.module';
import { AdminCategoryController } from './admin-category.controller';
import { CategoryController } from './category.controller';
import { CategoryService } from './category.service';

@Module({
  // ProductModule cho `/categories/:id/products`: danh sách sản phẩm đã có sẵn
  // bộ lọc, phân trang và luật publicOnly trong ProductService — viết lại ở đây
  // là hai chỗ để quên sửa khi luật đổi.
  imports: [AuthModule, ProductModule],
  controllers: [CategoryController, AdminCategoryController],
  providers: [CategoryService],
  exports: [CategoryService],
})
export class CategoryModule {}
