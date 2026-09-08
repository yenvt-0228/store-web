import { Injectable } from '@nestjs/common';
import { toNumber } from '../common/utils/money.util';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrderReportRow } from './orders-sheet';
import { MAX_REPORT_ROWS, OrderReportPayload } from './report.constant';

export interface CollectedOrders {
  rows: OrderReportRow[];
  // true = còn đơn khớp điều kiện nhưng bị cắt vì vượt MAX_REPORT_ROWS.
  truncated: boolean;
}

@Injectable()
export class OrderReportSource {
  constructor(private prisma: PrismaService) {}

  // Toàn bộ I/O nằm ở đây, trong process chính, để dùng chung một connection
  // pool của Prisma. Worker thread chỉ nhận mảng đã làm phẳng.
  async collect(payload: OrderReportPayload): Promise<CollectedOrders> {
    const orders = await this.prisma.order.findMany({
      where: this.buildWhere(payload),
      orderBy: { createdAt: 'desc' },
      // Lấy thừa 1 dòng để biết có bị cắt hay không. Cắt mà báo "completed"
      // với đúng MAX_REPORT_ROWS dòng thì admin không phân biệt được báo cáo
      // đầy đủ và báo cáo thiếu.
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
      // Decimal của Prisma không đi qua structured clone sang thread được,
      // đổi sang number ngay tại đây.
      totalAmount: toNumber(order.totalAmount),
    }));

    return { rows, truncated };
  }

  private buildWhere(payload: OrderReportPayload): Prisma.OrderWhereInput {
    const createdAt: Prisma.DateTimeFilter = {};

    if (payload.from) createdAt.gte = new Date(payload.from);

    // "to" chỉ có ngày (2026-12-31) được Date hiểu là 00:00 ngày đó, nên
    // lte sẽ loại hết đơn trong chính ngày cuối của khoảng. Chuyển thành
    // "nhỏ hơn 00:00 ngày kế tiếp" để lấy trọn ngày cuối. Có kèm giờ thì
    // người gọi đã nói rõ mốc, giữ nguyên lte.
    if (payload.to) {
      if (payload.to.includes('T')) {
        createdAt.lte = new Date(payload.to);
      } else {
        const next = new Date(payload.to);
        next.setUTCDate(next.getUTCDate() + 1);
        createdAt.lt = next;
      }
    }

    return {
      ...(payload.status ? { status: payload.status } : {}),
      ...(payload.from || payload.to ? { createdAt } : {}),
    };
  }
}
