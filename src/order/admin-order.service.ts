import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { I18nService } from 'nestjs-i18n';
import { paginated } from '../common/dto/paginated-response.dto';
import { Locale, toLocale } from '../common/constants/locale.constant';
import { OrderEvent } from '../common/events/order.event';
import { Prisma } from '../generated/prisma/client';
import {
  OrderPaymentStatus,
  OrderStatus,
  PaymentMethod,
} from '../generated/prisma/enums';
import { KafkaEventName, KafkaTopic } from '../kafka/kafka.constant';
import { OutboxService } from '../outbox/outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { adminOrderInclude, toOrderResponse } from './dto/order-response.dto';
import { ListOrderDto } from './dto/list-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { OrderService } from './order.service';
import {
  canTransition,
  requiresReason,
  shouldRestoreStock,
} from './order-state';

/**
 * Statuses that are mirrored onto Kafka, and under which name.
 *
 * Deliberately only two: the other transitions have no listener outside this
 * application, and a topic other services read is not the place to publish
 * everything just because it is available.
 */
const KAFKA_EVENT_BY_STATUS: Partial<Record<OrderStatus, KafkaEventName>> = {
  [OrderStatus.CONFIRMED]: KafkaEventName.ORDER_CONFIRMED,
  [OrderStatus.REJECTED]: KafkaEventName.ORDER_REJECTED,
};

@Injectable()
export class AdminOrderService {
  constructor(
    private prisma: PrismaService,
    private orderService: OrderService,
    private i18n: I18nService,
    private events: EventEmitter2,
    private outbox: OutboxService,
  ) {}

  async findAll(query: ListOrderDto) {
    const where: Prisma.OrderWhereInput = {};

    if (query.status) {
      where.status = query.status;
    }

    if (query.keyword) {
      where.OR = [
        { orderCode: { contains: query.keyword, mode: 'insensitive' } },
        { user: { name: { contains: query.keyword, mode: 'insensitive' } } },
        { user: { email: { contains: query.keyword, mode: 'insensitive' } } },
      ];
    }

    const { page = 1, limit = 10 } = query;
    const [orders, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        skip: query.skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: adminOrderInclude,
      }),
      this.prisma.order.count({ where }),
    ]);

    return paginated(orders.map(toOrderResponse), total, page, limit);
  }

  async findOne(id: string) {
    return toOrderResponse(await this.getOrderOrFail(id));
  }

  async updateStatus(id: string, dto: UpdateOrderStatusDto) {
    const order = await this.getOrderOrFail(id);

    if (order.status === dto.status) {
      throw new BadRequestException(this.i18n.t('order.SAME_STATUS'));
    }

    if (!canTransition(order.status, dto.status)) {
      throw new BadRequestException(
        this.i18n.t('order.INVALID_TRANSITION', {
          args: { from: order.status, to: dto.status },
        }),
      );
    }

    if (requiresReason(dto.status) && !dto.reason?.trim()) {
      throw new BadRequestException(this.i18n.t('order.REASON_REQUIRED'));
    }

    const { updated, payload } = await this.prisma.$transaction(async (tx) => {
      if (shouldRestoreStock(dto.status)) {
        await this.orderService.restoreStock(tx, order.items);
      }

      const result = await tx.order.update({
        where: { id },
        data: {
          status: dto.status,
          ...(dto.status === OrderStatus.REJECTED
            ? { rejectReason: dto.reason }
            : {}),
          ...(dto.status === OrderStatus.CANCELLED
            ? { cancelReason: dto.reason }
            : {}),
          // Giao xong đơn COD nghĩa là đã thu được tiền.
          ...(dto.status === OrderStatus.COMPLETED &&
          order.paymentMethod === PaymentMethod.COD
            ? { paymentStatus: OrderPaymentStatus.PAID }
            : {}),
          // Đơn đã trả tiền mà bị huỷ/từ chối -> chờ hoàn tiền.
          ...(shouldRestoreStock(dto.status) &&
          order.paymentStatus === OrderPaymentStatus.PAID
            ? { paymentStatus: OrderPaymentStatus.REFUNDED }
            : {}),
        },
        include: adminOrderInclude,
      });

      const event = {
        email: result.user.email,
        name: result.shippingName,
        orderCode: result.orderCode,
        reason: dto.reason ?? '',
        locale: toLocale(result.user.locale),
      };

      const eventName = KAFKA_EVENT_BY_STATUS[result.status];

      // Trong cùng transaction với chính lần đổi trạng thái: đơn đã CONFIRMED
      // trong DB mà event không lên được topic thì service khác không bao giờ
      // biết. OutboxRelay gửi sau, và có retry.
      if (eventName) {
        await this.outbox.record(tx, {
          topic: KafkaTopic.ORDER,
          key: result.orderCode,
          eventName,
          payload: event,
        });
      }

      return { updated: result, payload: event };
    });

    this.notify(updated.status, payload);

    return toOrderResponse(updated);
  }

  private notify(
    status: OrderStatus,
    payload: {
      email: string;
      name: string;
      orderCode: string;
      reason: string;
      locale: Locale;
    },
  ) {
    if (status === OrderStatus.CONFIRMED) {
      this.events.emit(OrderEvent.CONFIRMED, payload);
    }
    if (status === OrderStatus.REJECTED) {
      this.events.emit(OrderEvent.REJECTED, payload);
    }
  }

  private async getOrderOrFail(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: adminOrderInclude,
    });
    if (!order) {
      throw new NotFoundException(this.i18n.t('order.NOT_FOUND'));
    }
    return order;
  }
}
