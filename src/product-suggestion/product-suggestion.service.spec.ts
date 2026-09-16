import { NotFoundException } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { PrismaService } from '../prisma/prisma.service';
import { SuggestionStatus } from '../generated/prisma/enums';
import { ProductSuggestionService } from './product-suggestion.service';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 's-1',
    name: 'Bàn phím Alice',
    description: null,
    referenceUrl: null,
    status: SuggestionStatus.PENDING,
    note: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    reviewedAt: null,
    user: { id: 'u-1', name: 'Khách', email: 'k@store.local' },
    reviewer: null,
    ...overrides,
  };
}

function build() {
  const prisma = {
    productSuggestion: {
      create: jest.fn().mockResolvedValue(row()),
      findUnique: jest.fn().mockResolvedValue(row()),
      findMany: jest.fn().mockResolvedValue([row()]),
      count: jest.fn().mockResolvedValue(1),
      update: jest.fn().mockResolvedValue(row()),
    },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };

  const service = new ProductSuggestionService(
    prisma as unknown as PrismaService,
    { t: (key: string) => key } as unknown as I18nService,
  );

  return { service, prisma };
}

describe('ProductSuggestionService — lộ dữ liệu theo vai trò', () => {
  it('khách KHÔNG thấy email người gửi và người duyệt', async () => {
    // Khách xem yêu cầu của chính mình thì đã biết mình là ai, còn biết admin
    // nào duyệt thì không cần.
    const { service } = build();

    const result = await service.findMine('u-1', {} as never);

    expect(result.data[0]).not.toHaveProperty('user');
    expect(result.data[0]).not.toHaveProperty('reviewer');
  });

  it('admin thấy cả người gửi lẫn người duyệt', async () => {
    const { service } = build();

    const result = await service.findAll({} as never);

    expect(result.data[0]).toHaveProperty('user');
    expect(result.data[0]).toHaveProperty('reviewer');
  });

  it('danh sách của khách luôn khoá theo userId của chính họ', async () => {
    const { service, prisma } = build();

    await service.findMine('u-1', {
      status: SuggestionStatus.PENDING,
    } as never);

    const calls = prisma.productSuggestion.findMany.mock.calls as [
      { where: { userId: string; status: string } },
    ][];
    expect(calls[0][0].where).toEqual({
      userId: 'u-1',
      status: SuggestionStatus.PENDING,
    });
  });
});

describe('ProductSuggestionService.updateStatus', () => {
  it('ghi lại ai xử lý và lúc nào', async () => {
    const { service, prisma } = build();

    await service.updateStatus('s-1', 'admin-1', {
      status: SuggestionStatus.APPROVED,
      note: 'sẽ nhập tháng sau',
    });

    const calls = prisma.productSuggestion.update.mock.calls as [
      { data: { reviewedBy: string; reviewedAt: Date; note: string } },
    ][];
    expect(calls[0][0].data.reviewedBy).toBe('admin-1');
    expect(calls[0][0].data.reviewedAt).toBeInstanceOf(Date);
    expect(calls[0][0].data.note).toBe('sẽ nhập tháng sau');
  });

  it('không gửi note thì giữ nguyên ghi chú cũ, không xoá thành null', async () => {
    const { service, prisma } = build();

    await service.updateStatus('s-1', 'admin-1', {
      status: SuggestionStatus.REJECTED,
    });

    const calls = prisma.productSuggestion.update.mock.calls as [
      { data: Record<string, unknown> },
    ][];
    expect(calls[0][0].data).not.toHaveProperty('note');
  });

  it('404 khi yêu cầu không tồn tại', async () => {
    const { service, prisma } = build();
    prisma.productSuggestion.findUnique.mockResolvedValue(null);

    await expect(
      service.updateStatus('s-404', 'admin-1', {
        status: SuggestionStatus.APPROVED,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.productSuggestion.update).not.toHaveBeenCalled();
  });
});
