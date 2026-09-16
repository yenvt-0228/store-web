import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { ReportEvent } from '../common/events/report.event';
import type { MonthlyRevenueEvent } from '../common/events/report.event';
import { StatisticsService } from '../statistics/statistics.service';
import {
  RevenueReportService,
  monthBounds,
  previousMonth,
} from './revenue-report.service';

function build() {
  const prisma = {
    user: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { email: 'admin@store.local', name: 'Admin', locale: 'vi' },
        ]),
    },
  };

  const statistics = {
    dashboard: jest.fn().mockResolvedValue({
      revenue: 6000,
      completedOrders: 2,
      totalOrders: 3,
      averageOrderValue: 3000,
    }),
    topProducts: jest.fn().mockResolvedValue({
      data: [{ productName: 'Keychron K2', quantitySold: 3, revenue: 6000 }],
    }),
  };

  const emit = jest.fn();

  const service = new RevenueReportService(
    prisma as unknown as PrismaService,
    statistics as unknown as StatisticsService,
    { emit } as unknown as EventEmitter2,
  );

  return { service, prisma, statistics, emit };
}

describe('previousMonth', () => {
  it('lùi từ tháng 1 về tháng 12 năm trước', () => {
    // Job chạy mùng 1 tháng 1/2027 là để báo cáo tháng 12/2026.
    expect(previousMonth(new Date('2027-01-01T01:00:00Z'))).toEqual({
      month: 12,
      year: 2026,
    });
  });

  it('các tháng còn lại chỉ lùi một tháng', () => {
    expect(previousMonth(new Date('2026-08-01T01:00:00Z'))).toEqual({
      month: 7,
      year: 2026,
    });
  });
});

describe('monthBounds', () => {
  it('tháng 31 ngày', () => {
    expect(monthBounds(7, 2026)).toEqual({
      from: '2026-07-01',
      to: '2026-07-31',
    });
  });

  it('tháng 2 năm thường', () => {
    expect(monthBounds(2, 2026)).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
  });

  it('tháng 2 năm nhuận', () => {
    // "Ngày 0 của tháng sau" tự lo được chuyện này, không cần bảng tra.
    expect(monthBounds(2, 2028)).toEqual({
      from: '2028-02-01',
      to: '2028-02-29',
    });
  });

  it('tháng 12 không tràn sang năm sau', () => {
    expect(monthBounds(12, 2026)).toEqual({
      from: '2026-12-01',
      to: '2026-12-31',
    });
  });
});

describe('RevenueReportService.sendFor', () => {
  it('tổng hợp đúng khoảng của tháng rồi phát sự kiện cho từng admin', async () => {
    const { service, statistics, emit } = build();

    const sent = await service.sendFor(7, 2026);

    expect(statistics.dashboard).toHaveBeenCalledWith({
      from: '2026-07-01',
      to: '2026-07-31',
    });
    expect(sent).toBe(1);

    const [eventName, payload] = emit.mock.calls[0] as [
      string,
      MonthlyRevenueEvent,
    ];
    expect(eventName).toBe(ReportEvent.MONTHLY_REVENUE);
    expect(payload).toMatchObject({
      email: 'admin@store.local',
      month: 7,
      year: 2026,
      revenue: 6000,
      completedOrders: 2,
      locale: 'vi',
    });
    expect(payload.topProducts).toHaveLength(1);
  });

  it('mỗi admin một sự kiện riêng, không gộp danh sách người nhận', async () => {
    // Ngôn ngữ nằm trên từng người, và một địa chỉ hỏng không được kéo theo
    // những người còn lại.
    const { service, prisma, emit } = build();
    prisma.user.findMany.mockResolvedValue([
      { email: 'a@store.local', name: 'A', locale: 'vi' },
      { email: 'b@store.local', name: 'B', locale: 'en' },
    ]);

    await service.sendFor(7, 2026);

    expect(emit).toHaveBeenCalledTimes(2);
    const calls = emit.mock.calls as [string, MonthlyRevenueEvent][];
    const locales = calls.map(([, event]) => event.locale);
    expect(locales).toEqual(['vi', 'en']);
  });

  it('không có admin nào thì không phát sự kiện và không nổ', async () => {
    const { service, prisma, emit } = build();
    prisma.user.findMany.mockResolvedValue([]);

    await expect(service.sendFor(7, 2026)).resolves.toBe(0);
    expect(emit).not.toHaveBeenCalled();
  });
});

describe('RevenueReportService.sendMonthlyRevenue', () => {
  it('nuốt lỗi và ghi log — callback scheduler mà reject là hạ cả worker', async () => {
    const { service, statistics } = build();
    statistics.dashboard.mockRejectedValue(new Error('DB sập'));
    jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);

    await expect(service.sendMonthlyRevenue()).resolves.toBeUndefined();
  });
});
