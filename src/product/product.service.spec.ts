import { I18nService } from 'nestjs-i18n';
import { PrismaService } from '../prisma/prisma.service';
import { ProductService } from './product.service';

type StockRow = { id: string; quantity: number };

function build(rows: StockRow[]) {
  const findMany = jest.fn().mockResolvedValue(rows);
  // checkStock reads nothing else off the service, so i18n stays a stub.
  const service = new ProductService(
    { product: { findMany } } as unknown as PrismaService,
    {} as I18nService,
  );

  return { service, findMany };
}

describe('ProductService.checkStock', () => {
  it('marks a line sufficient only when the stock covers it', async () => {
    const { service } = build([
      { id: 'p-1', quantity: 10 },
      { id: 'p-2', quantity: 1 },
    ]);

    const result = await service.checkStock([
      { productId: 'p-1', quantity: 2 },
      { productId: 'p-2', quantity: 5 },
    ]);

    expect(result.lines).toEqual([
      {
        productId: 'p-1',
        requested: 2,
        available: 10,
        found: true,
        sufficient: true,
      },
      {
        productId: 'p-2',
        requested: 5,
        available: 1,
        found: true,
        sufficient: false,
      },
    ]);
    expect(result.allAvailable).toBe(false);
  });

  it('tells a missing product apart from one that sold out', async () => {
    // `available: 0` is ambiguous on its own, and the two need different
    // handling on the caller's side: one is a bad id, the other is a restock.
    const { service } = build([]);

    const result = await service.checkStock([
      { productId: 'gone', quantity: 1 },
    ]);

    expect(result.lines[0]).toMatchObject({ found: false, available: 0 });
  });

  it('does not answer "all available" to a request about nothing', async () => {
    // `[].every(...)` is true, which would have this report a basket of zero
    // items as fully in stock.
    const { service, findMany } = build([]);

    await expect(service.checkStock([])).resolves.toMatchObject({
      allAvailable: false,
      lines: [],
    });
    expect(findMany).toHaveBeenCalled();
  });

  it('ignores inactive and soft-deleted products', async () => {
    const { service, findMany } = build([]);

    await service.checkStock([{ productId: 'p-1', quantity: 1 }]);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'ACTIVE',
          deletedAt: null,
        }) as unknown,
      }),
    );
  });
});
