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
  it('a date-only "to" covers the whole day (lt next midnight), not lte 00:00', async () => {
    const { source, findMany } = sourceReturning(1);

    await source.collect({ requestedBy: 'admin', to: '2026-12-31' });

    const createdAt = argsOf(findMany).where.createdAt as Prisma.DateTimeFilter;

    expect(createdAt.lte).toBeUndefined();
    expect((createdAt.lt as Date).toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    );
  });

  it('a "to" with a time keeps lte at exactly the instant the caller gave', async () => {
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

  it('a space-separated "to" is a time, not a bare date pushed a day forward', async () => {
    const { source, findMany } = sourceReturning(1);

    // @IsISO8601 accepted this form and the old check looked for a "T" only,
    // so it fell into the date-only branch and widened the report by a day.
    await source.collect({
      requestedBy: 'admin',
      to: '2026-12-31 10:30:00Z',
    });

    const createdAt = argsOf(findMany).where.createdAt as Prisma.DateTimeFilter;

    expect(createdAt.lt).toBeUndefined();
    expect((createdAt.lte as Date).toISOString()).toBe(
      '2026-12-31T10:30:00.000Z',
    );
  });

  it('rejects a date that cannot be parsed instead of handing Invalid Date to Prisma', async () => {
    const { source, findMany } = sourceReturning(1);

    await expect(
      source.collect({ requestedBy: 'admin', to: '2026-13-45' }),
    ).rejects.toThrow('not a valid date');

    expect(findMany).not.toHaveBeenCalled();
  });

  it('keeps "from" as gte', async () => {
    const { source, findMany } = sourceReturning(1);

    await source.collect({ requestedBy: 'admin', from: '2026-01-01' });

    const createdAt = argsOf(findMany).where.createdAt as Prisma.DateTimeFilter;

    expect((createdAt.gte as Date).toISOString()).toBe(
      '2026-01-01T00:00:00.000Z',
    );
  });

  it('builds a where clause without createdAt when nothing is filtered', async () => {
    const { source, findMany } = sourceReturning(1);

    await source.collect({ requestedBy: 'admin' });

    expect(argsOf(findMany).where.createdAt).toBeUndefined();
  });

  it('reports truncated = false when the rows exactly reach the limit', async () => {
    const { source, findMany } = sourceReturning(MAX_REPORT_ROWS);

    const result = await source.collect({ requestedBy: 'admin' });

    // One extra row is what makes truncation detectable.
    expect(argsOf(findMany).take).toBe(MAX_REPORT_ROWS + 1);
    expect(result.rows).toHaveLength(MAX_REPORT_ROWS);
    expect(result.truncated).toBe(false);
  });

  it('reports truncated = true and cuts to exactly MAX_REPORT_ROWS rows', async () => {
    const { source } = sourceReturning(MAX_REPORT_ROWS + 1);

    const result = await source.collect({ requestedBy: 'admin' });

    expect(result.rows).toHaveLength(MAX_REPORT_ROWS);
    expect(result.truncated).toBe(true);
  });

  it('flattens rows: Decimal to number, Date to ISO string', async () => {
    const { source } = sourceReturning(1);

    const { rows } = await source.collect({ requestedBy: 'admin' });

    expect(rows[0].totalAmount).toBe(1234.56);
    expect(typeof rows[0].totalAmount).toBe('number');
    expect(rows[0].createdAt).toBe('2026-09-07T03:00:00.000Z');
    expect(rows[0].customerEmail).toBe('a@store-web.local');
    expect(rows[0].itemCount).toBe(2);
  });
});
