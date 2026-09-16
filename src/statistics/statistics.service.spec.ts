import { BadRequestException } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { Prisma } from '../generated/prisma/client';
import { OrderStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { StatisticsService } from './statistics.service';

function build() {
  const prisma = {
    order: {
      aggregate: jest.fn().mockResolvedValue({
        _sum: { totalAmount: new Prisma.Decimal('6000.00') },
        _count: 2,
      }),
      count: jest.fn().mockResolvedValue(3),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    orderItem: { groupBy: jest.fn().mockResolvedValue([]) },
    user: { count: jest.fn().mockResolvedValue(1) },
    product: { count: jest.fn().mockResolvedValue(5) },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };

  const service = new StatisticsService(
    prisma as unknown as PrismaService,
    { t: (key: string) => key } as unknown as I18nService,
  );

  return { service, prisma };
}

describe('StatisticsService.dashboard', () => {
  it('doanh thu chỉ tính đơn COMPLETED', async () => {
    // Đơn CONFIRMED/SHIPPING vẫn có thể bị huỷ hoặc hoàn — cộng vào là đếm
    // tiền chưa chắc giữ được.
    const { service, prisma } = build();

    await service.dashboard({});

    const calls = prisma.order.aggregate.mock.calls as [
      { where: { status: { in: OrderStatus[] } } },
    ][];
    expect(calls[0][0].where.status).toEqual({ in: [OrderStatus.COMPLETED] });
  });

  it('giá trị đơn trung bình chia cho số đơn HOÀN THÀNH, không phải tổng số đơn', async () => {
    // 6000 / 2 đơn hoàn thành = 3000. Chia cho 3 (gồm cả đơn huỷ) ra 2000 —
    // một con số không nói lên điều gì.
    const { service } = build();

    const result = await service.dashboard({});

    expect(result.revenue).toBe(6000);
    expect(result.completedOrders).toBe(2);
    expect(result.totalOrders).toBe(3);
    expect(result.averageOrderValue).toBe(3000);
  });

  it('chưa có đơn nào thì trung bình là 0, không phải NaN', async () => {
    const { service, prisma } = build();
    prisma.order.aggregate.mockResolvedValue({
      _sum: { totalAmount: null },
      _count: 0,
    });

    const result = await service.dashboard({});

    expect(result.revenue).toBe(0);
    expect(result.averageOrderValue).toBe(0);
  });

  it('bù 0 cho trạng thái không xuất hiện trong kết quả gộp', async () => {
    const { service, prisma } = build();
    prisma.order.groupBy.mockResolvedValue([
      { status: OrderStatus.COMPLETED, _count: { status: 2 } },
    ]);

    const result = await service.dashboard({});

    expect(result.ordersByStatus).toEqual({
      PENDING: 0,
      CONFIRMED: 0,
      SHIPPING: 0,
      COMPLETED: 2,
      CANCELLED: 0,
      REJECTED: 0,
    });
  });

  it('số mặt hàng đang bán không lọc theo khoảng ngày', async () => {
    // "Đang bán bao nhiêu mặt hàng" là câu hỏi về hiện tại, không phải về
    // khoảng thời gian admin đang xem.
    const { service, prisma } = build();

    await service.dashboard({ from: '2026-01-01', to: '2026-12-31' });

    expect(prisma.product.count).toHaveBeenCalledWith({
      where: { status: 'ACTIVE', deletedAt: null },
    });
  });

  it('ngày không có thật bị từ chối bằng 400, không phải 500', async () => {
    const { service } = build();

    // 2026-02-31 khớp regex nhưng `Date` lăn nó sang 3 tháng Ba.
    await expect(
      service.dashboard({ to: '2026-02-31' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('StatisticsService.revenueByMonth', () => {
  it('trả đủ 12 tháng, tháng không có đơn là 0', async () => {
    // Biểu đồ cột mà thiếu tháng thì client phải tự đoán chỗ trống, và doanh
    // thu 0 là thông tin thật chứ không phải dữ liệu vắng mặt.
    const { service, prisma } = build();
    prisma.$queryRaw.mockResolvedValue([
      { period: 3, revenue: new Prisma.Decimal('2000.00'), orders: BigInt(1) },
      { period: 7, revenue: new Prisma.Decimal('4000.00'), orders: BigInt(1) },
    ]);

    const result = await service.revenueByMonth({ year: 2026 });

    expect(result.data).toHaveLength(12);
    expect(result.data[2]).toEqual({ month: 3, revenue: 2000, orders: 1 });
    expect(result.data[6]).toEqual({ month: 7, revenue: 4000, orders: 1 });
    expect(result.data[0]).toEqual({ month: 1, revenue: 0, orders: 0 });
  });

  it('đổi bigint của COUNT(*) sang number — JSON.stringify ném lỗi trên bigint', async () => {
    const { service, prisma } = build();
    prisma.$queryRaw.mockResolvedValue([
      { period: 1, revenue: new Prisma.Decimal('10'), orders: BigInt(42) },
    ]);

    const result = await service.revenueByMonth({ year: 2026 });

    expect(typeof result.data[0].orders).toBe('number');
    expect(() => JSON.stringify(result)).not.toThrow();
  });
});

describe('StatisticsService.revenueByYear', () => {
  it('từ chối dải năm ngược', async () => {
    const { service } = build();

    await expect(
      service.revenueByYear({ fromYear: 2026, toYear: 2024 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('bù 0 cho năm không có đơn nào', async () => {
    const { service, prisma } = build();
    prisma.$queryRaw.mockResolvedValue([
      { period: 2026, revenue: new Prisma.Decimal('6000'), orders: BigInt(2) },
    ]);

    const result = await service.revenueByYear({
      fromYear: 2025,
      toYear: 2026,
    });

    expect(result.data).toEqual([
      { year: 2025, revenue: 0, orders: 0 },
      { year: 2026, revenue: 6000, orders: 2 },
    ]);
  });
});

describe('StatisticsService.topProducts', () => {
  it('gộp trên order_items và xếp theo doanh thu giảm dần', async () => {
    // Một đơn chứa nhiều mặt hàng, nên doanh thu từng sản phẩm nằm ở subtotal
    // của dòng, không phải totalAmount của đơn.
    const { service, prisma } = build();
    prisma.orderItem.groupBy.mockResolvedValue([
      {
        productId: 'p-1',
        productName: 'Keychron K2',
        _sum: { quantity: 3, subtotal: new Prisma.Decimal('6000') },
        _count: { orderId: 2 },
      },
    ]);

    const result = await service.topProducts({ limit: 5 });

    expect(prisma.orderItem.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['productId', 'productName'],
        orderBy: { _sum: { subtotal: 'desc' } },
        take: 5,
      }),
    );
    expect(result.data[0]).toEqual({
      productId: 'p-1',
      productName: 'Keychron K2',
      quantitySold: 3,
      revenue: 6000,
      orderCount: 2,
    });
  });
});
