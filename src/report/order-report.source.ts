import { Injectable } from '@nestjs/common';
import { parseIsoBoundary } from '../common/utils/date.util';
import { toNumber } from '../common/utils/money.util';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MAX_REPORT_ROWS } from './report.constant';
import { CollectedOrders, OrderReportPayload } from './report.interface';

// ISO 8601 allows both "2026-12-31T10:30" and "2026-12-31 10:30", and the DTO
// accepts both. Looking for a "T" alone would read the second one as a bare
// date and push the boundary a full day forward.
const TIME_PART = /[T ]\d{2}:\d{2}/;

function hasTime(value: string): boolean {
  return TIME_PART.test(value);
}

/**
 * Turns a report boundary into a Date.
 *
 * `OrderReportDto` already rejects everything this rejects, so in practice it
 * only guards a payload built somewhere else — a replayed job, a queue entry
 * written by hand. Kept because the alternative is an Invalid Date reaching
 * Prisma, which fails the job three times over with an error naming neither the
 * field nor the value.
 *
 * @param value - Raw boundary as it came from the request.
 * @param field - Field name, used in the error message.
 * @returns The parsed date.
 * @throws {Error} When `value` does not name a real calendar date.
 */
function parseBoundary(value: string, field: 'from' | 'to'): Date {
  const parsed = parseIsoBoundary(value);

  if (!parsed) {
    throw new Error(
      `Report filter "${field}" is not a valid date: "${value}".`,
    );
  }

  return parsed;
}

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
   * @param payload - Date range and status filters of the report.
   * @returns The `where` clause; empty when no filter was supplied.
   */
  private buildWhere(payload: OrderReportPayload): Prisma.OrderWhereInput {
    const createdAt: Prisma.DateTimeFilter = {};

    if (payload.from) createdAt.gte = parseBoundary(payload.from, 'from');

    // A date-only "to" (2026-12-31) is parsed as midnight, so `lte` would drop
    // every order made during that last day. Turn it into "before midnight of
    // the next day" to cover the whole day. When a time is supplied the caller
    // meant that exact instant, so `lte` is kept.
    if (payload.to) {
      const to = parseBoundary(payload.to, 'to');

      if (hasTime(payload.to)) {
        createdAt.lte = to;
      } else {
        to.setUTCDate(to.getUTCDate() + 1);
        createdAt.lt = to;
      }
    }

    return {
      ...(payload.status ? { status: payload.status } : {}),
      ...(payload.from || payload.to ? { createdAt } : {}),
    };
  }
}
