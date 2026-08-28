import { ServiceUnavailableException } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { CartService } from './cart.service';

describe('CartService.getCart — gia hạn TTL là best-effort', () => {
  const i18n = { t: (key: string) => key } as unknown as I18nService;

  const prisma = {
    product: { findMany: jest.fn().mockResolvedValue([]) },
  } as unknown as PrismaService;

  // pipeline().hgetall().expire().exec() trả về [[errRead, raw], [errTouch, n]]
  const serviceWith = (results: [Error | null, unknown][] | null) => {
    const pipeline = {
      hgetall: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(results),
    };

    const redis = {
      ensureConnected: jest.fn().mockResolvedValue(undefined),
      client: { pipeline: () => pipeline },
    } as unknown as RedisService;

    return new CartService(redis, prisma, i18n);
  };

  it('EXPIRE hỏng (Redis read-only) -> vẫn trả về giỏ, không ném lỗi', async () => {
    const service = serviceWith([
      [null, { 'product-1': '2' }],
      [
        new Error('READONLY You can not write against a read only replica'),
        null,
      ],
    ]);

    const cart = await service.getCart('user-1');

    // Sản phẩm không còn trong DB nên hiện là không mua được, nhưng quan
    // trọng là request KHÔNG hỏng vì nhánh ghi thất bại.
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].productId).toBe('product-1');
  });

  it('HGETALL hỏng -> ném 503, không trả về giỏ rỗng giả', async () => {
    const service = serviceWith([
      [new Error('Connection is closed'), null],
      [null, 1],
    ]);

    await expect(service.getCart('user-1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('pipeline trả null -> ném 503 thay vì coi như giỏ rỗng', async () => {
    const service = serviceWith(null);

    await expect(service.getCart('user-1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

describe('CartService.removeItems — dọn giỏ sau khi đơn đã commit', () => {
  const i18n = { t: (key: string) => key } as unknown as I18nService;
  const prisma = {
    product: { findMany: jest.fn().mockResolvedValue([]) },
  } as unknown as PrismaService;

  // multi().hdel().expire().exec() trả về [[errHdel, n], [errExpire, n]]
  const serviceWith = (
    results: [Error | null, unknown][] | null,
    connectError?: Error,
  ) => {
    const multi = {
      hdel: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(results),
    };

    const ensureConnected = connectError
      ? jest.fn().mockRejectedValue(connectError)
      : jest.fn().mockResolvedValue(undefined);

    const redis = {
      ensureConnected,
      client: { multi: () => multi },
    } as unknown as RedisService;

    return {
      service: new CartService(redis, prisma, i18n),
      multi,
      ensureConnected,
    };
  };

  it('xoá được -> trả true, HDEL nhận đủ danh sách sản phẩm', async () => {
    const { service, multi } = serviceWith([
      [null, 2],
      [null, 1],
    ]);

    await expect(
      service.removeItems('user-1', ['product-1', 'product-2']),
    ).resolves.toBe(true);
    expect(multi.hdel).toHaveBeenCalledWith(
      'cart:user-1',
      'product-1',
      'product-2',
    );
  });

  it('HDEL lỗi -> trả false chứ không ném lỗi ra ngoài', async () => {
    const { service } = serviceWith([
      [
        new Error('READONLY You can not write against a read only replica'),
        null,
      ],
      [null, 1],
    ]);

    // Ném lỗi ở đây sẽ khiến client tưởng đặt hàng thất bại dù đơn đã tạo.
    await expect(service.removeItems('user-1', ['product-1'])).resolves.toBe(
      false,
    );
  });

  it('multi() bị huỷ (exec trả null) -> trả false', async () => {
    const { service } = serviceWith(null);

    await expect(service.removeItems('user-1', ['product-1'])).resolves.toBe(
      false,
    );
  });

  it('Redis chết hẳn, không kết nối được -> trả false', async () => {
    const { service } = serviceWith(null, new Error('ENOTFOUND red-abc'));

    await expect(service.removeItems('user-1', ['product-1'])).resolves.toBe(
      false,
    );
  });

  it('danh sách rỗng -> true và không chạm tới Redis', async () => {
    const { service, ensureConnected } = serviceWith([]);

    await expect(service.removeItems('user-1', [])).resolves.toBe(true);
    expect(ensureConnected).not.toHaveBeenCalled();
  });
});
