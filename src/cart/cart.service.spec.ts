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
