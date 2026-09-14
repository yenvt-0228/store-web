import { Controller, UseFilters, UseGuards } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { GrpcExceptionFilter } from './grpc-exception.filter';
import { GrpcInternalGuard } from './grpc-internal.guard';
import { OrderGrpcService } from './order.grpc.service';
import type {
  GetOrderRequest,
  ListOrdersRequest,
  ListOrdersResponse,
  Order,
} from './grpc.interface';

@UseGuards(GrpcInternalGuard)
@UseFilters(GrpcExceptionFilter)
@Controller()
export class OrderGrpcController {
  constructor(private readonly orders: OrderGrpcService) {}

  /**
   * @param request - The order code to look up.
   * @returns The order.
   */
  @GrpcMethod('OrderService', 'GetOrder')
  getOrder(request: GetOrderRequest): Promise<Order> {
    return this.orders.getOrder(request);
  }

  /**
   * @param request - Owner, optional status filter and page window.
   * @returns One page of that customer's orders.
   */
  @GrpcMethod('OrderService', 'ListOrders')
  listOrders(request: ListOrdersRequest): Promise<ListOrdersResponse> {
    return this.orders.listOrders(request);
  }
}
