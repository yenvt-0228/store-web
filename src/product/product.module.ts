import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminProductController } from './admin-product.controller';
import { ProductController } from './product.controller';
import { ProductShareService } from './product-share.service';
import { ProductService } from './product.service';

@Module({
  imports: [AuthModule],
  controllers: [ProductController, AdminProductController],
  providers: [ProductService, ProductShareService],
  exports: [ProductService],
})
export class ProductModule {}
