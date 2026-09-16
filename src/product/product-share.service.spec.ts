import { ConfigService } from '@nestjs/config';
import { ProductService } from './product.service';
import { ProductShareService } from './product-share.service';

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p-1',
    name: 'Keychron K2',
    description: 'Bàn phím cơ 75%',
    price: 2000,
    quantity: 5,
    inStock: true,
    primaryImage: 'https://cdn.local/k2.png',
    ...overrides,
  };
}

function build(config: Record<string, string> = {}) {
  const findOne = jest.fn().mockResolvedValue(product());
  const service = new ProductShareService(
    { findOne } as unknown as ProductService,
    {
      get: (key: string) => config[key],
    } as unknown as ConfigService,
  );

  return { service, findOne };
}

describe('ProductShareService.shareInfo', () => {
  it('chỉ chia sẻ sản phẩm công khai', async () => {
    // Sản phẩm nháp hoặc đã xoá mềm thì không có gì để chia sẻ, và càng không
    // nên lộ tên ra ngoài.
    const { service, findOne } = build({ FRONTEND_URL: 'https://shop.local' });

    await service.shareInfo('p-1');

    expect(findOne).toHaveBeenCalledWith('p-1', true);
  });

  it('link trỏ về FRONTEND_URL, không phải APP_URL của API', async () => {
    const { service } = build({
      FRONTEND_URL: 'https://shop.local',
      APP_URL: 'https://api.local',
    });

    const result = await service.shareInfo('p-1');

    expect(result.url).toBe('https://shop.local/products/p-1');
    expect(result.openGraph['og:url']).toBe('https://shop.local/products/p-1');
  });

  it('lùi về APP_URL khi chưa cấu hình FRONTEND_URL', async () => {
    const { service } = build({ APP_URL: 'https://api.local' });

    const result = await service.shareInfo('p-1');

    expect(result.url).toBe('https://api.local/products/p-1');
  });

  it('encode URL trong link chia sẻ', async () => {
    const { service } = build({ FRONTEND_URL: 'https://shop.local' });

    const result = await service.shareInfo('p-1');

    expect(result.shareUrls.facebook).toContain(
      encodeURIComponent('https://shop.local/products/p-1'),
    );
    expect(result.shareUrls.twitter).toContain(
      encodeURIComponent('Keychron K2'),
    );
  });

  it('không có ảnh thì dùng card nhỏ, không phải summary_large_image rỗng', async () => {
    const { service, findOne } = build({ FRONTEND_URL: 'https://shop.local' });
    findOne.mockResolvedValue(product({ primaryImage: null }));

    const result = await service.shareInfo('p-1');

    expect(result.twitter['twitter:card']).toBe('summary');
    expect(result.openGraph['og:image']).toBe('');
  });

  it('cắt mô tả dài ở ranh giới từ, không cắt giữa chữ', async () => {
    const { service, findOne } = build({ FRONTEND_URL: 'https://shop.local' });
    findOne.mockResolvedValue(product({ description: 'bàn phím '.repeat(40) }));

    const result = await service.shareInfo('p-1');
    const description = result.openGraph['og:description'];

    expect(description.length).toBeLessThanOrEqual(201);
    expect(description.endsWith('…')).toBe(true);
    expect(description).not.toMatch(/\s…$/);
  });

  it('gộp khoảng trắng thừa trong mô tả', async () => {
    const { service, findOne } = build({ FRONTEND_URL: 'https://shop.local' });
    findOne.mockResolvedValue(
      product({ description: '  Bàn phím\n\n  cơ   75%  ' }),
    );

    const result = await service.shareInfo('p-1');

    expect(result.openGraph['og:description']).toBe('Bàn phím cơ 75%');
  });

  it('mô tả rỗng thành chuỗi rỗng, không phải "null"', async () => {
    const { service, findOne } = build({ FRONTEND_URL: 'https://shop.local' });
    findOne.mockResolvedValue(product({ description: null }));

    const result = await service.shareInfo('p-1');

    expect(result.openGraph['og:description']).toBe('');
  });

  it('hết hàng thì báo out of stock', async () => {
    const { service, findOne } = build({ FRONTEND_URL: 'https://shop.local' });
    findOne.mockResolvedValue(product({ inStock: false }));

    const result = await service.shareInfo('p-1');

    expect(result.openGraph['product:availability']).toBe('out of stock');
    expect(result.openGraph['product:price:amount']).toBe('2000.00');
  });
});
