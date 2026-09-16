import { Injectable } from '@nestjs/common';
import { toDateRange } from '../common/utils/date-range.util';
import { toNumber } from '../common/utils/money.util';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MAX_REPORT_ROWS } from './report.constant';
import { CollectedOrders, OrderReportPayload } from './report.interface';

@Injectable()
export class OrderReportSource {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reads the orders matching the report filters and flattens them for the
   * worker thread.
   *
   * All I/O lives here, in the main process, so a single Prisma connection pool
   * is shared. The worker thread only ever receives the flattened rows.
   *
   * @param payload - Date range and status filters of the report.
   * @returns The rows to render, plus whether they were cut at
   * {@link MAX_REPORT_ROWS}.
   */
  async collect(payload: OrderReportPayload): Promise<CollectedOrders> {
    const orders = await this.prisma.order.findMany({
      where: this.buildWhere(payload),
      orderBy: { createdAt: 'desc' },
      // Fetch one extra row to detect truncation. Cutting the result while
      // still reporting "completed" with exactly MAX_REPORT_ROWS rows would
      // leave the admin unable to tell a full report from a partial one.
      take: MAX_REPORT_ROWS + 1,
      select: {
        orderCode: true,
        createdAt: true,
        status: true,
        paymentStatus: true,
        paymentMethod: true,
        shippingName: true,
        shippingPhone: true,
        shippingAddress: true,
        totalAmount: true,
        user: { select: { email: true } },
        _count: { select: { items: true } },
      },
    });

    const truncated = orders.length > MAX_REPORT_ROWS;

    const rows = orders.slice(0, MAX_REPORT_ROWS).map((order) => ({
      orderCode: order.orderCode,
      createdAt: order.createdAt.toISOString(),
      status: order.status,
      paymentStatus: order.paymentStatus,
      paymentMethod: order.paymentMethod,
      customerName: order.shippingName,
      customerEmail: order.user.email,
      shippingPhone: order.shippingPhone,
      shippingAddress: order.shippingAddress,
      itemCount: order._count.items,
      // Prisma Decimal cannot be structured-cloned into the thread, so it is
      // converted to a number right here.
      totalAmount: toNumber(order.totalAmount),
    }));

    return { rows, truncated };
  }

  /**
   * Translates the report filters into a Prisma `where` clause.
   *
   * The date boundaries go through the shared `toDateRange`, which is also what
   * the statistics endpoints use: a date-only "to" has to cover the whole last
   * day, and that rule belongs in one place rather than in every caller.
   *
   * @param payload - Date range and status filters of the report.
   * @returns The `where` clause; empty when no filter was supplied.
   */
  private buildWhere(payload: OrderReportPayload): Prisma.OrderWhereInput {
    const createdAt = toDateRange(payload.from, payload.to, {
      from: 'from',
      to: 'to',
    });

    return {
      ...(payload.status ? { status: payload.status } : {}),
      ...(createdAt ? { createdAt } : {}),
    };
  }
}
