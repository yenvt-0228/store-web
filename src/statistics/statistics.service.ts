import { BadRequestException, Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { toDateRange } from '../common/utils/date-range.util';
import { toNumber } from '../common/utils/money.util';
import { Prisma } from '../generated/prisma/client';
import {
  OrderPaymentStatus,
  OrderStatus,
  PaymentMethod,
  ProductStatus,
} from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { RevenueMonthlyDto, RevenueYearlyDto } from './dto/revenue-query.dto';
import { StatisticsRangeDto, TopProductsDto } from './dto/statistics-range.dto';
import { DEFAULT_TOP_PRODUCTS, REVENUE_STATUSES } from './statistics.constant';

/** Một dòng do truy vấn gộp theo kỳ trả về. SUM(numeric) ra Decimal. */
interface PeriodRow {
  period: number;
  revenue: Prisma.Decimal | null;
  orders: bigint;
}

@Injectable()
export class StatisticsService {
  constructor(
    private prisma: PrismaService,
    private i18n: I18nService,
  ) {}

  /**
   * Bức tranh tổng quan của một khoảng thời gian.
   *
   * @param query - Khoảng ngày, cả hai đầu đều tuỳ chọn.
   * @returns Doanh thu, số đơn, giá trị đơn trung bình, phân bố trạng thái và
   * số khách mới.
   */
  async dashboard(query: StatisticsRangeDto) {
    const createdAt = this.rangeOf(query);
    const where = createdAt ? { createdAt } : {};

    const [revenue, orderCount, byStatus, newCustomers, activeProducts] =
      await Promise.all([
        this.prisma.order.aggregate({
          where: { ...where, status: { in: REVENUE_STATUSES } },
          _sum: { totalAmount: true },
          _count: true,
        }),
        this.prisma.order.count({ where }),
        this.prisma.order.groupBy({
          by: ['status'],
          where,
          _count: { status: true },
        }),
        this.prisma.user.count({ where }),
        // Không lọc theo ngày: "đang bán bao nhiêu mặt hàng" là câu hỏi về hiện
        // tại, không phải về khoảng thời gian admin đang xem.
        this.prisma.product.count({
          where: { status: ProductStatus.ACTIVE, deletedAt: null },
        }),
      ]);

    const completed = revenue._count;
    const total = toNumber(revenue._sum.totalAmount ?? 0);

    return {
      range: this.describeRange(query),
      revenue: total,
      completedOrders: completed,
      totalOrders: orderCount,
      // Trung bình trên đơn ĐÃ HOÀN THÀNH, cùng mẫu số với doanh thu. Chia cho
      // tổng số đơn (gồm cả đơn huỷ) sẽ ra một con số không nói lên điều gì.
      averageOrderValue:
        completed === 0 ? 0 : Math.round((total / completed) * 100) / 100,
      ordersByStatus: this.fillCounts(
        Object.values(OrderStatus),
        byStatus.map((row) => [row.status, row._count.status]),
      ),
      newCustomers,
      activeProducts,
    };
  }

  /**
   * Sản phẩm bán chạy, xếp theo doanh thu mang lại.
   *
   * Gộp trên `order_items` chứ không phải `orders`: một đơn chứa nhiều mặt
   * hàng, nên doanh thu của từng sản phẩm nằm ở `subtotal` của dòng, không phải
   * `totalAmount` của đơn.
   *
   * Tên sản phẩm lấy từ `productName` đã chốt trên dòng đơn hàng, không join
   * sang bảng products: đó là tên tại thời điểm mua, và sản phẩm có thể đã đổi
   * tên hoặc đã bị xoá mềm.
   *
   * @param query - Khoảng ngày và số dòng muốn lấy.
   * @returns Bảng xếp hạng, doanh thu giảm dần.
   */
  async topProducts(query: TopProductsDto) {
    const createdAt = this.rangeOf(query);

    const rows = await this.prisma.orderItem.groupBy({
      by: ['productId', 'productName'],
      where: {
        order: {
          status: { in: REVENUE_STATUSES },
          ...(createdAt ? { createdAt } : {}),
        },
      },
      _sum: { quantity: true, subtotal: true },
      _count: { orderId: true },
      orderBy: { _sum: { subtotal: 'desc' } },
      take: query.limit ?? DEFAULT_TOP_PRODUCTS,
    });

    return {
      range: this.describeRange(query),
      data: rows.map((row) => ({
        productId: row.productId,
        productName: row.productName,
        quantitySold: row._sum.quantity ?? 0,
        revenue: toNumber(row._sum.subtotal ?? 0),
        orderCount: row._count.orderId,
      })),
    };
  }

  /**
   * Doanh thu 12 tháng của một năm.
   *
   * @param query - Năm cần xem; mặc định là năm hiện tại.
   * @returns Đủ 12 tháng, tháng không có đơn nào là 0.
   */
  async revenueByMonth(query: RevenueMonthlyDto) {
    const year = query.year ?? new Date().getUTCFullYear();

    const rows = await this.prisma.$queryRaw<PeriodRow[]>`
      SELECT EXTRACT(MONTH FROM "created_at")::int AS period,
             SUM("total_amount")                   AS revenue,
             COUNT(*)                              AS orders
      FROM "orders"
      WHERE "status" = ANY (${REVENUE_STATUSES}::"order_status"[])
        AND "created_at" >= ${new Date(Date.UTC(year, 0, 1))}
        AND "created_at" <  ${new Date(Date.UTC(year + 1, 0, 1))}
      GROUP BY period
      ORDER BY period
    `;

    return {
      year,
      // Đủ 12 tháng chứ không chỉ tháng có đơn: biểu đồ cột mà thiếu tháng thì
      // client phải tự đoán chỗ trống, và một tháng doanh thu 0 là thông tin
      // thật chứ không phải dữ liệu vắng mặt.
      data: this.fillPeriods(rows, 1, 12, (month) => ({ month })),
    };
  }

  /**
   * Doanh thu theo năm, trong một dải năm.
   *
   * @param query - Năm đầu và năm cuối; mặc định là 5 năm gần nhất.
   * @returns Mỗi năm một dòng, năm không có đơn nào là 0.
   * @throws {BadRequestException} Khi `fromYear` lớn hơn `toYear`.
   */
  async revenueByYear(query: RevenueYearlyDto) {
    const currentYear = new Date().getUTCFullYear();
    const toYear = query.toYear ?? currentYear;
    const fromYear = query.fromYear ?? toYear - 4;

    if (fromYear > toYear) {
      throw new BadRequestException(this.i18n.t('statistics.INVALID_YEARS'));
    }

    const rows = await this.prisma.$queryRaw<PeriodRow[]>`
      SELECT EXTRACT(YEAR FROM "created_at")::int AS period,
             SUM("total_amount")                  AS revenue,
             COUNT(*)                             AS orders
      FROM "orders"
      WHERE "status" = ANY (${REVENUE_STATUSES}::"order_status"[])
        AND "created_at" >= ${new Date(Date.UTC(fromYear, 0, 1))}
        AND "created_at" <  ${new Date(Date.UTC(toYear + 1, 0, 1))}
      GROUP BY period
      ORDER BY period
    `;

    return {
      fromYear,
      toYear,
      data: this.fillPeriods(rows, fromYear, toYear, (year) => ({ year })),
    };
  }

  /**
   * Thống kê đơn hàng theo trạng thái, thanh toán và phương thức.
   *
   * @param query - Khoảng ngày, cả hai đầu đều tuỳ chọn.
   * @returns Tổng số đơn cùng ba cách bổ dọc nó.
   */
  async orders(query: StatisticsRangeDto) {
    const createdAt = this.rangeOf(query);
    const where = createdAt ? { createdAt } : {};

    const [total, byStatus, byPaymentStatus, byPaymentMethod] =
      await Promise.all([
        this.prisma.order.count({ where }),
        this.prisma.order.groupBy({
          by: ['status'],
          where,
          _count: { status: true },
        }),
        this.prisma.order.groupBy({
          by: ['paymentStatus'],
          where,
          _count: { paymentStatus: true },
        }),
        this.prisma.order.groupBy({
          by: ['paymentMethod'],
          where,
          _count: { paymentMethod: true },
        }),
      ]);

    return {
      range: this.describeRange(query),
      total,
      byStatus: this.fillCounts(
        Object.values(OrderStatus),
        byStatus.map((row) => [row.status, row._count.status]),
      ),
      byPaymentStatus: this.fillCounts(
        Object.values(OrderPaymentStatus),
        byPaymentStatus.map((row) => [
          row.paymentStatus,
          row._count.paymentStatus,
        ]),
      ),
      byPaymentMethod: this.fillCounts(
        Object.values(PaymentMethod),
        byPaymentMethod.map((row) => [
          row.paymentMethod,
          row._count.paymentMethod,
        ]),
      ),
    };
  }

  /**
   * Dịch `from`/`to` sang bộ lọc Prisma.
   *
   * @param query - Khoảng ngày như client gửi.
   * @returns Bộ lọc, hoặc `undefined` khi không có biên nào.
   * @throws {BadRequestException} Khi một biên không phải ngày có thật.
   */
  private rangeOf(query: StatisticsRangeDto) {
    try {
      return toDateRange(query.from, query.to);
    } catch {
      // DTO đã chặn hết ở tầng HTTP; đây chỉ còn là lưới an toàn, và nó phải
      // ra 400 chứ không phải 500.
      throw new BadRequestException(this.i18n.t('statistics.INVALID_RANGE'));
    }
  }

  /**
   * @param query - Khoảng ngày như client gửi.
   * @returns Chính khoảng đó, dội lại trong response để client biết con số vừa
   * nhận được tính trên khoảng nào.
   */
  private describeRange(query: StatisticsRangeDto) {
    return { from: query.from ?? null, to: query.to ?? null };
  }

  /**
   * Bù 0 cho mọi giá trị enum không xuất hiện trong kết quả gộp.
   *
   * @param keys - Toàn bộ giá trị có thể có.
   * @param counts - Các cặp [giá trị, số lượng] mà truy vấn trả về.
   * @returns Bản đồ đủ khoá, khoá nào không có là 0.
   */
  private fillCounts(
    keys: string[],
    counts: [string, number][],
  ): Record<string, number> {
    const filled: Record<string, number> = {};
    for (const key of keys) filled[key] = 0;
    for (const [key, count] of counts) filled[key] = count;
    return filled;
  }

  /**
   * Trải kết quả gộp lên đủ dải kỳ, kỳ nào không có đơn thì bằng 0.
   *
   * @param rows - Dòng truy vấn trả về, chỉ gồm kỳ có đơn.
   * @param first - Kỳ đầu của dải.
   * @param last - Kỳ cuối của dải.
   * @param label - Đặt tên khoá cho kỳ (`month` hay `year`).
   * @returns Một dòng cho mỗi kỳ trong dải.
   */
  private fillPeriods<T extends object>(
    rows: PeriodRow[],
    first: number,
    last: number,
    label: (period: number) => T,
  ) {
    const found = new Map(rows.map((row) => [row.period, row]));

    return Array.from({ length: last - first + 1 }, (_, index) => {
      const period = first + index;
      const row = found.get(period);

      return {
        ...label(period),
        revenue: toNumber(row?.revenue ?? 0),
        // COUNT(*) của Postgres là bigint, và JSON.stringify ném lỗi trên
        // bigint chứ không tự đổi sang số.
        orders: Number(row?.orders ?? 0),
      };
    });
  }
}
