import { Injectable } from '@nestjs/common';
import { ProductService } from '../product/product.service';
import type {
  CheckStockRequest,
  CheckStockResponse,
  GetProductRequest,
  Product,
} from './grpc.interface';

/**
 * Turns product requests into domain calls and domain results into proto
 * messages, so `ProductGrpcController` only has to declare the rpcs.
 */
@Injectable()
export class ProductGrpcService {
  constructor(private readonly products: ProductService) {}

  /**
   * @param request - Product id.
   * @returns The product, as far as an internal caller needs it.
   */
  async getProduct(request: GetProductRequest): Promise<Product> {
    // publicOnly: an internal service is not an admin. A draft or soft-deleted
    // product is invisible here for the same reason it is invisible to a
    // customer — if a service needs those, that is a separate contract with a
    // separate guard, not a boolean on this one.
    const product = await this.products.findOne(request.id, true);

    return {
      id: product.id,
      name: product.name,
      // Two decimals, always: the column is Decimal(12,2) and the proto
      // declares a string, so the cents must not depend on the value.
      price: product.price.toFixed(2),
      quantity: product.quantity,
      status: product.status,
    };
  }

  /**
   * @param request - Product ids and the quantity wanted of each.
   * @returns Per-item availability, and whether the whole basket fits.
   */
  async checkStock(request: CheckStockRequest): Promise<CheckStockResponse> {
    // `defaults: true` turns an empty repeated field into [], never undefined —
    // but a caller on a hand-rolled client may still send nothing at all.
    return this.products.checkStock(request.items ?? []);
  }
}
