import { Controller, UseFilters, UseGuards } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { GrpcExceptionFilter } from './grpc-exception.filter';
import { GrpcInternalGuard } from './grpc-internal.guard';
import { ProductGrpcService } from './product.grpc.service';
import type {
  CheckStockRequest,
  CheckStockResponse,
  GetProductRequest,
  Product,
} from './grpc.interface';

@UseGuards(GrpcInternalGuard)
@UseFilters(GrpcExceptionFilter)
@Controller()
export class ProductGrpcController {
  constructor(private readonly products: ProductGrpcService) {}

  /**
   * @param request - Product id.
   * @returns The product, as far as an internal caller needs it.
   */
  @GrpcMethod('ProductService', 'GetProduct')
  getProduct(request: GetProductRequest): Promise<Product> {
    return this.products.getProduct(request);
  }

  /**
   * @param request - Product ids and the quantity wanted of each.
   * @returns Per-item availability, and whether the whole basket fits.
   */
  @GrpcMethod('ProductService', 'CheckStock')
  checkStock(request: CheckStockRequest): Promise<CheckStockResponse> {
    return this.products.checkStock(request);
  }
}
