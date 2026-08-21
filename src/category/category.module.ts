import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminCategoryController } from './admin-category.controller';
import { CategoryService } from './category.service';

@Module({
  imports: [AuthModule],
  controllers: [AdminCategoryController],
  providers: [CategoryService],
  exports: [CategoryService],
})
export class CategoryModule {}
