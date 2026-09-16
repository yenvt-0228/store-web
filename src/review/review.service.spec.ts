import { ConflictException, ForbiddenException } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { Prisma } from '../generated/prisma/client';
import { OrderStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { ReviewService } from './review.service';

const PRODUCT = { id: 'p-1' };

function build() {
  const prisma = {
    product: { findFirst: jest.fn().mockResolvedValue(PRODUCT) },
    orderItem: { findFirst: jest.fn() },
    review: {
      create: jest.fn(),
      findUnique: jest.fn(),
      groupBy: jest.fn().mockResolvedValue([]),
    },
  };

  const service = new ReviewService(
    prisma as unknown as PrismaService,
    { t: (key: string) => key } as unknown as I18nService,
  );

  return { service, prisma };
}

describe('ReviewService.create', () => {
  it('chỉ cho đánh giá khi có đơn ĐÃ HOÀN THÀNH chứa sản phẩm', async () => {
    const { service, prisma } = build();
    prisma.orderItem.findFirst.mockResolvedValue({ id: 'oi-1' });
    prisma.review.create.mockResolvedValue({
      id: 'r-1',
      productId: 'p-1',
      rating: 5,
      content: null,
      user: { id: 'u-1', name: 'A', avatar: null },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await service.create('u-1', 'p-1', { rating: 5 });

    // CONFIRMED không đủ: đơn đã xác nhận vẫn có thể bị huỷ hoặc hoàn.
    expect(prisma.orderItem.findFirst).toHaveBeenCalledWith({
      where: {
        productId: 'p-1',
        order: { userId: 'u-1', status: { in: [OrderStatus.COMPLETED] } },
      },
      select: { id: true },
    });
  });

  it('chặn người chưa mua', async () => {
    const { service, prisma } = build();
    prisma.orderItem.findFirst.mockResolvedValue(null);

    await expect(
      service.create('u-1', 'p-1', { rating: 5 }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.review.create).not.toHaveBeenCalled();
  });

  it('dịch P2002 của unique index thành 409, không để lộ lỗi Prisma', async () => {
    // Không đọc-rồi-ghi để kiểm tra trùng: hai request song song đều đọc thấy
    // "chưa có" rồi cùng ghi, và chỉ unique index ở DB mới chặn được.
    const { service, prisma } = build();
    prisma.orderItem.findFirst.mockResolvedValue({ id: 'oi-1' });
    prisma.review.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '7.9.0',
      }),
    );

    await expect(
      service.create('u-1', 'p-1', { rating: 5 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('không nuốt lỗi Prisma khác P2002', async () => {
    const { service, prisma } = build();
    prisma.orderItem.findFirst.mockResolvedValue({ id: 'oi-1' });
    prisma.review.create.mockRejectedValue(new Error('mất kết nối'));

    await expect(service.create('u-1', 'p-1', { rating: 5 })).rejects.toThrow(
      'mất kết nối',
    );
  });
});

describe('ReviewService.summaryOf', () => {
  it('trả đủ 5 mức sao, mức không ai chọn là 0', async () => {
    // Client dựng biểu đồ 5 cột không nên phải tự đoán cột nào vắng mặt.
    const { service, prisma } = build();
    prisma.review.groupBy.mockResolvedValue([
      { rating: 5, _count: { rating: 3 } },
      { rating: 4, _count: { rating: 1 } },
    ]);

    const summary = await service.summaryOf('p-1');

    expect(summary.breakdown).toEqual({
      '1': 0,
      '2': 0,
      '3': 0,
      '4': 1,
      '5': 3,
    });
    expect(summary.total).toBe(4);
    // (5*3 + 4*1) / 4 = 4.75 -> làm tròn 1 chữ số
    expect(summary.average).toBe(4.8);
  });

  it('sản phẩm chưa có đánh giá thì trung bình là 0, không phải NaN', async () => {
    const { service } = build();

    const summary = await service.summaryOf('p-1');

    expect(summary).toEqual({
      average: 0,
      total: 0,
      breakdown: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
    });
  });
});

describe('ReviewService quyền sửa/xoá', () => {
  it('chặn người khác sửa đánh giá không phải của mình', async () => {
    const { service, prisma } = build();
    prisma.review.findUnique.mockResolvedValue({ id: 'r-1', userId: 'u-2' });

    await expect(
      service.update({ id: 'u-1', roles: ['USER'] }, 'r-1', { rating: 1 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('cho ADMIN đi qua để dọn nội dung bẩn', async () => {
    const { service, prisma } = build();
    prisma.review.findUnique.mockResolvedValue({ id: 'r-1', userId: 'u-2' });
    const update = jest.fn().mockResolvedValue({
      id: 'r-1',
      productId: 'p-1',
      rating: 1,
      content: null,
      user: { id: 'u-2', name: 'B', avatar: null },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    (prisma.review as unknown as { update: unknown }).update = update;

    await service.update({ id: 'u-1', roles: ['ADMIN'] }, 'r-1', { rating: 1 });

    expect(update).toHaveBeenCalled();
  });
});
