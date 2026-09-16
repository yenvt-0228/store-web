import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminProductSuggestionController } from './admin-product-suggestion.controller';
import { ProductSuggestionController } from './product-suggestion.controller';
import { ProductSuggestionService } from './product-suggestion.service';

@Module({
  imports: [AuthModule],
  controllers: [ProductSuggestionController, AdminProductSuggestionController],
  providers: [ProductSuggestionService],
  exports: [ProductSuggestionService],
})
export class ProductSuggestionModule {}
