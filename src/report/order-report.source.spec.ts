import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrderReportSource } from './order-report.source';
import { MAX_REPORT_ROWS } from './report.constant';

interface FindManyArgs {
  where: Prisma.OrderWhereInput;
  take: number;
}

function order(index: number) {
  return {
    orderCode: `DH-${index}`,
    createdAt: new Date('2026-09-07T03:00:00.000Z'),
    status: 'CONFIRMED',
    paymentStatus: 'PAID',
    paymentMethod: 'COD',
    shippingName: 'Khách',
    shippingPhone: '0900000001',
    shippingAddress: 'Số 1',
    totalAmount: new Prisma.Decimal('1234.56'),
    user: { email: 'a@store-web.local' },
    _count: { items: 2 },
  };
}

function sourceReturning(rowCount: number) {
  const findMany = jest
    .fn()
    .mockResolvedValue(Array.from({ length: rowCount }, (_, i) => order(i)));

  const prisma = { order: { findMany } } as unknown as PrismaService;

  return { source: new OrderReportSource(prisma), findMany };
}

const argsOf = (findMany: jest.Mock): FindManyArgs =>
  (findMany.mock.calls as FindManyArgs[][])[0][0];

describe('OrderReportSource.collect', () => {
  it('to chỉ có ngày -> lấy TRỌN ngày đó (lt nửa đêm hôm sau), không phải lte 00:00', async () => {
    const { source, findMany } = sourceReturning(1);

    await source.collect({ requestedBy: 'admin', to: '2026-12-31' });

    const createdAt = argsOf(findMany).where.createdAt as Prisma.DateTimeFilter;

    expect(createdAt.lte).toBeUndefined();
    expect((createdAt.lt as Date).toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    );
  });

  it('to có kèm giờ -> giữ nguyên lte theo đúng mốc người gọi đưa', async () => {
    const { source, findMany } = sourceReturning(1);

    await source.collect({
      requestedBy: 'admin',
      to: '2026-12-31T10:30:00.000Z',
    });

    const createdAt = argsOf(findMany).where.createdAt as Prisma.DateTimeFilter;

    expect(createdAt.lt).toBeUndefined();
    expect((createdAt.lte as Date).toISOString()).toBe(
      '2026-12-31T10:30:00.000Z',
    );
  });

  it('from được giữ nguyên là gte', async () => {
    const { source, findMany } = sourceReturning(1);

    await source.collect({ requestedBy: 'admin', from: '2026-01-01' });

    const createdAt = argsOf(findMany).where.createdAt as Prisma.DateTimeFilter;

    expect((createdAt.gte as Date).toISOString()).toBe(
      '2026-01-01T00:00:00.000Z',
    );
  });

  it('không lọc gì -> where không có createdAt', async () => {
    const { source, findMany } = sourceReturning(1);

    await source.collect({ requestedBy: 'admin' });

    expect(argsOf(findMany).where.createdAt).toBeUndefined();
  });

  it('vừa đủ giới hạn -> truncated = false', async () => {
    const { source, findMany } = sourceReturning(MAX_REPORT_ROWS);

    const result = await source.collect({ requestedBy: 'admin' });

    // Lấy thừa 1 dòng mới biết được có bị cắt hay không.
    expect(argsOf(findMany).take).toBe(MAX_REPORT_ROWS + 1);
    expect(result.rows).toHaveLength(MAX_REPORT_ROWS);
    expect(result.truncated).toBe(false);
  });

  it('vượt giới hạn -> truncated = true và cắt về đúng MAX_REPORT_ROWS dòng', async () => {
    const { source } = sourceReturning(MAX_REPORT_ROWS + 1);

    const result = await source.collect({ requestedBy: 'admin' });

    expect(result.rows).toHaveLength(MAX_REPORT_ROWS);
    expect(result.truncated).toBe(true);
  });

  it('làm phẳng dòng: Decimal -> number, Date -> ISO string', async () => {
    const { source } = sourceReturning(1);

    const { rows } = await source.collect({ requestedBy: 'admin' });

    expect(rows[0].totalAmount).toBe(1234.56);
    expect(typeof rows[0].totalAmount).toBe('number');
    expect(rows[0].createdAt).toBe('2026-09-07T03:00:00.000Z');
    expect(rows[0].customerEmail).toBe('a@store-web.local');
    expect(rows[0].itemCount).toBe(2);
  });
});
