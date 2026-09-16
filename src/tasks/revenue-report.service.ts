import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { toLocale } from '../common/constants/locale.constant';
import { RoleName } from '../common/constants/role.constant';
import type { MonthlyRevenueEvent } from '../common/events/report.event';
import { ReportEvent } from '../common/events/report.event';
import { UserStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { StatisticsService } from '../statistics/statistics.service';

/**
 * 01:00 ngày mùng 1 hàng tháng.
 *
 * "Cuối tháng" trong đặc tả được hiểu là *báo cáo của tháng vừa kết thúc*, nên
 * job chạy đầu tháng sau chứ không phải ngày cuối tháng: chạy 23:00 ngày 31 thì
 * thiếu doanh thu của chính ngày hôm đó, và con số gửi đi tháng nào cũng hụt.
 */
const MONTHLY_CRON = '0 1 1 * *';

/**
 * Múi giờ của lịch chạy.
 *
 * UTC để khớp với thống kê: `revenueByMonth` cắt tháng bằng `EXTRACT(MONTH FROM
 * created_at)` trên timestamp UTC. Nếu cron cắt theo giờ Việt Nam thì email và
 * dashboard sẽ nói hai con số khác nhau cho cùng một tháng.
 */
const CRON_TIMEZONE = 'UTC';

// Bảng xếp hạng đính kèm trong email. Đủ để thấy xu hướng, không dài tới mức
// phải cuộn trên điện thoại.
const TOP_PRODUCTS_IN_MAIL = 5;

@Injectable()
export class RevenueReportService {
  private readonly logger = new Logger(RevenueReportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly statistics: StatisticsService,
    private readonly events: EventEmitter2,
  ) {}

  @Cron(MONTHLY_CRON, { timeZone: CRON_TIMEZONE })
  async sendMonthlyRevenue(): Promise<void> {
    const { month, year } = previousMonth(new Date());

    try {
      await this.sendFor(month, year);
    } catch (error) {
      // Callback của scheduler mà reject thì unhandled rejection sẽ hạ luôn
      // worker. Báo cáo trễ một tháng còn hơn mất cả process đang chạy queue.
      this.logger.error(
        `Không gửi được báo cáo doanh thu ${month}/${year}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Tổng hợp một tháng rồi phát sự kiện cho từng admin.
   *
   * Tách khỏi `sendMonthlyRevenue` để gọi lại được bằng tay khi cần gửi lại một
   * tháng cũ, mà không phải đợi tới mùng 1.
   *
   * @param month - Tháng cần tổng hợp, 1-12.
   * @param year - Năm của tháng đó.
   * @returns Số admin đã được phát sự kiện.
   */
  async sendFor(month: number, year: number): Promise<number> {
    const admins = await this.activeAdmins();

    if (admins.length === 0) {
      this.logger.warn(
        `Không có admin nào đang hoạt động để nhận báo cáo ${month}/${year}.`,
      );
      return 0;
    }

    const { from, to } = monthBounds(month, year);

    // Dùng lại đúng StatisticsService của dashboard, không tự gộp một kiểu
    // khác: hai định nghĩa doanh thu song song là hai con số rồi sẽ lệch nhau,
    // và không ai biết con số nào đúng.
    const [summary, top] = await Promise.all([
      this.statistics.dashboard({ from, to }),
      this.statistics.topProducts({ from, to, limit: TOP_PRODUCTS_IN_MAIL }),
    ]);

    for (const admin of admins) {
      const event: MonthlyRevenueEvent = {
        email: admin.email,
        name: admin.name,
        month,
        year,
        revenue: summary.revenue,
        completedOrders: summary.completedOrders,
        totalOrders: summary.totalOrders,
        averageOrderValue: summary.averageOrderValue,
        topProducts: top.data.map((row) => ({
          productName: row.productName,
          quantitySold: row.quantitySold,
          revenue: row.revenue,
        })),
        locale: toLocale(admin.locale),
      };

      // Phát sự kiện thay vì gọi thẳng MailDispatcher: MailModule là module
      // động, import nó lần thứ hai ở đây sẽ dựng thêm một bản MailProcessor
      // trong cùng process. MailListener đã lắng nghe sẵn rồi.
      this.events.emit(ReportEvent.MONTHLY_REVENUE, event);
    }

    this.logger.log(
      `Báo cáo doanh thu ${month}/${year}: ${summary.revenue} từ ${summary.completedOrders} đơn, đã gửi cho ${admins.length} admin.`,
    );

    return admins.length;
  }

  /**
   * @returns Admin đang hoạt động, kèm ngôn ngữ để dựng email đúng thứ tiếng.
   */
  private activeAdmins() {
    return this.prisma.user.findMany({
      where: {
        status: UserStatus.ACTIVE,
        roles: { some: { role: { name: RoleName.ADMIN } } },
      },
      select: { email: true, name: true, locale: true },
    });
  }
}

/**
 * @param now - Thời điểm job chạy.
 * @returns Tháng liền trước, đã xử lý việc lùi qua mốc năm.
 */
export function previousMonth(now: Date): { month: number; year: number } {
  const month = now.getUTCMonth(); // 0-11, nên chính nó đã là "tháng trước" dạng 1-12
  return month === 0
    ? { month: 12, year: now.getUTCFullYear() - 1 }
    : { month, year: now.getUTCFullYear() };
}

/**
 * @param month - Tháng, 1-12.
 * @param year - Năm.
 * @returns Cặp biên `from`/`to` dạng YYYY-MM-DD phủ trọn tháng đó.
 */
export function monthBounds(
  month: number,
  year: number,
): { from: string; to: string } {
  const first = new Date(Date.UTC(year, month - 1, 1));
  // Ngày 0 của tháng sau chính là ngày cuối cùng của tháng này — khỏi phải nhớ
  // tháng nào 30, tháng nào 31, và năm nào tháng Hai có 29 ngày.
  const last = new Date(Date.UTC(year, month, 0));

  return { from: isoDay(first), to: isoDay(last) };
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
