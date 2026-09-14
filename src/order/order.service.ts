import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomBytes } from 'node:crypto';
import { I18nService } from 'nestjs-i18n';
import { CartItemIssue } from '../cart/cart.constant';
import { CartItemView, CartService } from '../cart/cart.service';
import { paginated } from '../common/dto/paginated-response.dto';
import { toLocale } from '../common/constants/locale.constant';
import {
  OrderEvent,
  type OrderCreatedEvent,
} from '../common/events/order.event';
import { multiply, sum, toNumber } from '../common/utils/money.util';
import { Prisma } from '../generated/prisma/client';
import {
  OrderPaymentStatus,
  OrderStatus,
  ProductStatus,
} from '../generated/prisma/enums';
import { KafkaEventName, KafkaTopic } from '../kafka/kafka.constant';
import { OutboxService } from '../outbox/outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { CreateOrderDto, OrderItemInputDto } from './dto/create-order.dto';
import { ListOrderDto } from './dto/list-order.dto';
import { orderInclude, toOrderResponse } from './dto/order-response.dto';

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    private prisma: PrismaService,
    private cart: CartService,
    private i18n: I18nService,
    private events: EventEmitter2,
    private outbox: OutboxService,
  ) {}

  async create(userId: string, dto: CreateOrderDto) {
    const inputs = await this.resolveItems(userId, dto);
    const products = await this.loadProducts(inputs);

    const orderItems = inputs.map((input) => {
      const product = products.get(input.productId)!;
      return {
        productId: product.id,
        // Chốt tên và giá tại thời điểm mua.
        productName: product.name,
        productPrice: product.price,
        quantity: input.quantity,
        subtotal: multiply(product.price, input.quantity),
      };
    });

    const totalAmount = sum(orderItems.map((item) => item.subtotal));

    // Đọc trước khi mở transaction: payload của event nằm trong cùng
    // transaction với đơn hàng, nên phải có sẵn email/locale trước đó. Đọc sớm
    // cũng nghĩa là một userId không hợp lệ dừng lại trước khi trừ tồn kho.
    const recipient = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true, locale: true },
    });

    const { order, event } = await this.prisma.$transaction(async (tx) => {
      for (const item of orderItems) {
        const updated = await tx.product.updateMany({
          where: {
            id: item.productId,
            status: ProductStatus.ACTIVE,
            deletedAt: null,
            quantity: { gte: item.quantity },
          },
          data: { quantity: { decrement: item.quantity } },
        });

        if (updated.count !== 1) {
          throw new BadRequestException(
            this.i18n.t('order.OUT_OF_STOCK', {
              args: { name: item.productName },
            }),
          );
        }
      }

      const created = await tx.order.create({
        data: {
          userId,
          orderCode: this.generateOrderCode(),
          paymentMethod: dto.paymentMethod,
          totalAmount,
          shippingName: dto.shippingName,
          shippingPhone: dto.shippingPhone,
          shippingAddress: dto.shippingAddress,
          items: { create: orderItems },
        },
        include: orderInclude,
      });

      const payload: OrderCreatedEvent = {
        email: recipient.email,
        name: created.shippingName,
        orderCode: created.orderCode,
        totalAmount: toNumber(created.totalAmount),
        locale: toLocale(recipient.locale),
      };

      // Ghi trong cùng transaction với đơn hàng: hoặc cả hai cùng commit, hoặc
      // không có gì cả. Publish thẳng lên Kafka ở đây thì đơn đã nằm trong DB
      // mà event có thể mất khi broker chết — OutboxRelay lo việc gửi sau.
      await this.outbox.record(tx, {
        topic: KafkaTopic.ORDER,
        key: created.orderCode,
        eventName: KafkaEventName.ORDER_CREATED,
        payload,
      });

      return { order: created, event: payload };
    });

    if (!dto.items?.length) {
      const productIds = orderItems.map((item) => item.productId);
      const cleared = await this.cart.removeItems(userId, productIds);

      if (!cleared) {
        this.logger.error(
          `Đơn ${order.orderCode} đã tạo nhưng chưa dọn được giỏ của user ` +
            `${userId} — còn lại: ${productIds.join(', ')}`,
        );
      }
    }

    // Bus nội bộ vẫn giữ nguyên cho mail: nó chạy trong cùng process nên không
    // có vấn đề dual-write như Kafka.
    this.events.emit(OrderEvent.CREATED, event);

    return toOrderResponse(order);
  }

  async findAll(userId: string, query: ListOrderDto) {
    const where: Prisma.OrderWhereInput = { userId };
    if (query.status) {
      where.status = query.status;
    }

    const { page = 1, limit = 10 } = query;
    const [orders, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        skip: query.skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: orderInclude,
      }),
      this.prisma.order.count({ where }),
    ]);

    return paginated(orders.map(toOrderResponse), total, page, limit);
  }

  async findOne(userId: string, id: string) {
    return toOrderResponse(await this.getOwnedOrder(userId, id));
  }

  /**
   * Reads one order by its business key, for an internal caller.
   *
   * No `userId` and no ownership check, unlike {@link OrderService.findOne}:
   * the caller here is another service acting on the order itself, not a
   * customer browsing their own. Whether that service may ask at all is settled
   * at the transport boundary, by `GrpcInternalGuard`.
   *
   * Keyed by `orderCode` rather than the UUID because that is what travels on
   * the Kafka topic as the message key, so a listener already holds one.
   *
   * @param orderCode - Business key of the order.
   * @returns The order in the same shape the HTTP API returns.
   * @throws {NotFoundException} When no order carries that code.
   */
  async findByCode(orderCode: string) {
    const order = await this.prisma.order.findUnique({
      where: { orderCode },
      include: orderInclude,
    });

    if (!order) {
      throw new NotFoundException(this.i18n.t('order.NOT_FOUND'));
    }

    return toOrderResponse(order);
  }

  async cancel(userId: string, id: string, dto: CancelOrderDto) {
    const order = await this.getOwnedOrder(userId, id);

    if (order.status !== OrderStatus.PENDING) {
      throw new BadRequestException(this.i18n.t('order.CANNOT_CANCEL'));
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.restoreStock(tx, order.items);

      return tx.order.update({
        where: { id },
        data: {
          status: OrderStatus.CANCELLED,
          cancelReason: dto.reason ?? this.i18n.t('order.CANCELLED_BY_USER'),
          ...(order.paymentStatus === OrderPaymentStatus.PAID
            ? { paymentStatus: OrderPaymentStatus.REFUNDED }
            : {}),
        },
        include: orderInclude,
      });
    });

    return toOrderResponse(updated);
  }

  async restoreStock(
    tx: Prisma.TransactionClient,
    items: { productId: string; quantity: number }[],
  ) {
    for (const item of items) {
      await tx.product.update({
        where: { id: item.productId },
        data: { quantity: { increment: item.quantity } },
      });
    }
  }

  private async getOwnedOrder(userId: string, id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: orderInclude,
    });

    if (!order) {
      throw new NotFoundException(this.i18n.t('order.NOT_FOUND'));
    }

    if (order.userId !== userId) {
      throw new ForbiddenException(this.i18n.t('order.FORBIDDEN'));
    }

    return order;
  }

  private async resolveItems(
    userId: string,
    dto: CreateOrderDto,
  ): Promise<OrderItemInputDto[]> {
    if (dto.items?.length) {
      return this.mergeDuplicates(dto.items);
    }

    const cart = await this.cart.getCart(userId);

    if (cart.items.length === 0) {
      throw new BadRequestException(this.i18n.t('order.EMPTY_ITEMS'));
    }

    this.assertCartOrderable(cart.items);

    return this.mergeDuplicates(
      cart.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
      })),
    );
  }

  // Ngừng bán thì phải bỏ khỏi giỏ, thiếu hàng thì chỉ cần giảm số lượng.
  private assertCartOrderable(items: CartItemView[]): void {
    const unsellable = items.filter(
      (item) =>
        item.reason === CartItemIssue.DELETED ||
        item.reason === CartItemIssue.INACTIVE,
    );

    if (unsellable.length > 0) {
      throw new BadRequestException(
        this.i18n.t('order.UNAVAILABLE_ITEMS', {
          args: { names: unsellable.map((item) => item.name).join(', ') },
        }),
      );
    }

    const short = items.filter(
      (item) => item.reason === CartItemIssue.INSUFFICIENT_STOCK,
    );

    if (short.length > 0) {
      throw new BadRequestException(
        this.i18n.t('order.INSUFFICIENT_STOCK_ITEMS', {
          args: {
            items: short
              .map((item) => `${item.name}: ${item.stock}`)
              .join(', '),
          },
        }),
      );
    }
  }

  private mergeDuplicates(items: OrderItemInputDto[]): OrderItemInputDto[] {
    const merged = new Map<string, number>();

    for (const item of items) {
      merged.set(
        item.productId,
        (merged.get(item.productId) ?? 0) + item.quantity,
      );
    }

    return [...merged].map(([productId, quantity]) => ({
      productId,
      quantity,
    }));
  }

  private async loadProducts(items: OrderItemInputDto[]) {
    const products = await this.prisma.product.findMany({
      where: {
        id: { in: items.map((item) => item.productId) },
        status: ProductStatus.ACTIVE,
        deletedAt: null,
      },
    });

    const byId = new Map(products.map((product) => [product.id, product]));

    const missing = items.find((item) => !byId.has(item.productId));
    if (missing) {
      throw new NotFoundException(this.i18n.t('product.NOT_FOUND'));
    }

    return byId;
  }

  private generateOrderCode(): string {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const random = randomBytes(3).toString('hex').toUpperCase();
    return `ORD-${date}-${random}`;
  }
}
