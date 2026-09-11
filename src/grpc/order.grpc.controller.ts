import { Controller, UseFilters, UseGuards } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { toNumber } from '../common/utils/money.util';
import { OrderService } from '../order/order.service';
import { OrderStatus } from '../generated/prisma/enums';
import { GrpcExceptionFilter } from './grpc-exception.filter';
import { GrpcInternalGuard } from './grpc-internal.guard';
import type {
  GetOrderRequest,
  ListOrdersRequest,
  ListOrdersResponse,
  Order,
} from './grpc.interface';

type OrderResponse = Awaited<ReturnType<OrderService['findByCode']>>;

/**
 * Serialises money the way the proto declares it.
 *
 * Two decimals, always: the column is `Decimal(12,2)`, and a caller parsing
 * "1234.5" against a schema that promises cents has to guess.
 *
 * @param value - Amount as the HTTP layer already reduced it.
 * @returns The amount as a fixed-point string.
 */
function money(value: number): string {
  return toNumber(value).toFixed(2);
}

/**
 * Maps the shared order response onto the proto message.
 *
 * The two shapes are close but not the same, and the difference is deliberate:
 * `Date` becomes RFC 3339, `number` money becomes a decimal string, and fields
 * the HTTP client needs but a service does not (payment details, cancel and
 * reject reasons) are simply not in the contract. A proto is a promise; the
 * fewer fields in it, the fewer promises to keep.
 *
 * @param order - Order as the domain service returns it.
 * @returns The message to put on the wire.
 */
function toGrpcOrder(order: OrderResponse): Order {
  return {
    id: order.id,
    orderCode: order.orderCode,
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    totalAmount: money(order.totalAmount),
    shipping: order.shipping,
    items: order.items.map((item) => ({
      productId: item.productId,
      productName: item.productName,
      productPrice: money(item.productPrice),
      quantity: item.quantity,
      subtotal: money(item.subtotal),
    })),
    createdAt: order.createdAt.toISOString(),
  };
}

@UseGuards(GrpcInternalGuard)
@UseFilters(GrpcExceptionFilter)
@Controller()
export class OrderGrpcController {
  constructor(private readonly orders: OrderService) {}

  /**
   * @param request - The order code to look up.
   * @returns The order.
   */
  @GrpcMethod('OrderService', 'GetOrder')
  async getOrder(request: GetOrderRequest): Promise<Order> {
    return toGrpcOrder(await this.orders.findByCode(request.orderCode));
  }

  /**
   * @param request - Owner, optional status filter and page window.
   * @returns One page of that customer's orders.
   */
  @GrpcMethod('OrderService', 'ListOrders')
  async listOrders(request: ListOrdersRequest): Promise<ListOrdersResponse> {
    // proto3 has no null: an unset status arrives as "" and an unset page as 0,
    // so the defaults live here rather than in the message.
    const page = request.page || 1;
    const limit = request.limit || 10;

    const result = await this.orders.findAll(request.userId, {
      page,
      limit,
      skip: (page - 1) * limit,
      ...(request.status ? { status: request.status as OrderStatus } : {}),
    });

    return {
      orders: result.data.map(toGrpcOrder),
      total: result.meta.total,
    };
  }
}
