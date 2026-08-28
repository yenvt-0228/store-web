import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { I18nService } from 'nestjs-i18n';
import { toNumber } from '../common/utils/money.util';
import {
  OrderPaymentStatus,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { MockCallbackDto } from './dto/mock-callback.dto';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private i18n: I18nService,
  ) {}

  async create(userId: string, dto: CreatePaymentDto) {
    const order = await this.getOwnedOrder(userId, dto.orderId);

    if (
      order.status === OrderStatus.CANCELLED ||
      order.status === OrderStatus.REJECTED
    ) {
      throw new BadRequestException(this.i18n.t('payment.ORDER_CLOSED'));
    }
    if (order.paymentStatus === OrderPaymentStatus.PAID) {
      throw new ConflictException(this.i18n.t('payment.ALREADY_PAID'));
    }
    // Đã có giao dịch thành công thì không tạo thêm (payments 1:1 với order).
    if (order.payment?.status === PaymentStatus.PAID) {
      throw new ConflictException(this.i18n.t('payment.ALREADY_PAID'));
    }

    const isOnline = dto.paymentMethod === PaymentMethod.ONLINE;
    const transactionId = isOnline ? this.generateTransactionId() : null;

    const payment = await this.prisma.$transaction(async (tx) => {
      const result = await tx.payment.upsert({
        where: { orderId: order.id },
        update: {
          paymentMethod: dto.paymentMethod,
          transactionId,
          status: PaymentStatus.PENDING,
          amount: order.totalAmount,
        },
        create: {
          orderId: order.id,
          paymentMethod: dto.paymentMethod,
          transactionId,
          amount: order.totalAmount,
          status: PaymentStatus.PENDING,
        },
      });

      if (order.paymentMethod !== dto.paymentMethod) {
        await tx.order.update({
          where: { id: order.id },
          data: { paymentMethod: dto.paymentMethod },
        });
      }

      return result;
    });

    return {
      payment: this.toResponse(payment),
      paymentUrl: isOnline
        ? `${this.appUrl}/payments/mock-gateway?transactionId=${transactionId}`
        : null,
      message: isOnline
        ? this.i18n.t('payment.ONLINE_CREATED')
        : this.i18n.t('payment.COD_CREATED'),
    };
  }

  async handleCallback(dto: MockCallbackDto) {
    this.assertValidSignature(dto);

    const payment = await this.prisma.payment.findUnique({
      where: { transactionId: dto.transactionId },
      include: { order: true },
    });

    if (!payment) {
      throw new NotFoundException(this.i18n.t('payment.NOT_FOUND'));
    }
    if (payment.status !== PaymentStatus.PENDING) {
      return {
        payment: this.toResponse(payment),
        message: this.i18n.t('payment.ALREADY_PROCESSED'),
      };
    }

    const paid = dto.success;

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: paid ? PaymentStatus.PAID : PaymentStatus.FAILED,
          paidAt: paid ? new Date() : null,
          paymentData: {
            gateway: 'mock',
            success: paid,
            receivedAt: new Date().toISOString(),
          },
        },
      });

      if (paid) {
        await tx.order.update({
          where: { id: payment.orderId },
          data: { paymentStatus: OrderPaymentStatus.PAID },
        });
      }

      return result;
    });

    return {
      payment: this.toResponse(updated),
      message: paid
        ? this.i18n.t('payment.SUCCESS')
        : this.i18n.t('payment.FAILED'),
    };
  }

  async findByOrder(userId: string, orderId: string) {
    const order = await this.getOwnedOrder(userId, orderId);

    return {
      orderCode: order.orderCode,
      orderStatus: order.status,
      paymentStatus: order.paymentStatus,
      paymentMethod: order.paymentMethod,
      totalAmount: toNumber(order.totalAmount),
      payment: order.payment ? this.toResponse(order.payment) : null,
    };
  }

  private assertValidSignature(dto: MockCallbackDto): void {
    const secret = this.config.get<string>('PAYMENT_CALLBACK_SECRET');

    if (!secret) {
      this.logger.error(
        'Chưa cấu hình PAYMENT_CALLBACK_SECRET — mọi callback thanh toán bị từ chối.',
      );
      throw new ServiceUnavailableException(
        this.i18n.t('payment.CALLBACK_NOT_CONFIGURED'),
      );
    }

    const expected = createHmac('sha256', secret)
      .update(`${dto.transactionId}|${String(dto.success)}`)
      .digest('hex');

    const received = Buffer.from(dto.signature, 'utf8');
    const digest = Buffer.from(expected, 'utf8');

    if (
      received.length !== digest.length ||
      !timingSafeEqual(received, digest)
    ) {
      throw new UnauthorizedException(this.i18n.t('payment.INVALID_SIGNATURE'));
    }
  }

  private get appUrl(): string {
    return (
      this.config.get<string>('APP_URL') ??
      `http://localhost:${this.config.get<string>('PORT') ?? 3000}`
    );
  }

  private generateTransactionId(): string {
    return `MOCK-${randomBytes(8).toString('hex').toUpperCase()}`;
  }

  private toResponse(payment: {
    id: string;
    paymentMethod: PaymentMethod;
    transactionId: string | null;
    amount: unknown;
    status: PaymentStatus;
    paidAt: Date | null;
  }) {
    return {
      id: payment.id,
      method: payment.paymentMethod,
      transactionId: payment.transactionId,
      amount: toNumber(payment.amount as never),
      status: payment.status,
      paidAt: payment.paidAt,
    };
  }

  private async getOwnedOrder(userId: string, orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { payment: true },
    });

    if (!order) {
      throw new NotFoundException(this.i18n.t('order.NOT_FOUND'));
    }
    if (order.userId !== userId) {
      throw new ForbiddenException(this.i18n.t('order.FORBIDDEN'));
    }

    return order;
  }
}
