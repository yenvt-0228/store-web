import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { PrismaService } from '../prisma/prisma.service';
import { CommentService } from './comment.service';

function build() {
  const prisma = {
    product: { findFirst: jest.fn().mockResolvedValue({ id: 'p-1' }) },
    comment: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({
        id: 'c-1',
        productId: 'p-1',
        content: 'sửa rồi',
        user: { id: 'u-1', name: 'A', avatar: null },
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    },
  };

  const service = new CommentService(
    prisma as unknown as PrismaService,
    { t: (key: string) => key } as unknown as I18nService,
  );

  return { service, prisma };
}

describe('CommentService.create', () => {
  it('không bắt phải mua hàng — bình luận là chỗ hỏi TRƯỚC khi mua', async () => {
    const { service, prisma } = build();
    prisma.comment.create.mockResolvedValue({
      id: 'c-1',
      productId: 'p-1',
      content: 'còn màu đen không shop?',
      user: { id: 'u-1', name: 'A', avatar: null },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const comment = await service.create('u-1', 'p-1', {
      content: 'còn màu đen không shop?',
    });

    expect(comment.content).toBe('còn màu đen không shop?');
  });

  it('404 khi sản phẩm đã ẩn hoặc đã xoá', async () => {
    const { service, prisma } = build();
    prisma.product.findFirst.mockResolvedValue(null);

    await expect(
      service.create('u-1', 'p-1', { content: 'hi' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('CommentService.remove', () => {
  it('soft delete, không xoá hẳn', async () => {
    // Bình luận bị ADMIN gỡ là chứng cứ cho khiếu nại về sau, và nó không được
    // tính vào con số nào nên để lại không méo dữ liệu.
    const { service, prisma } = build();
    prisma.comment.findFirst.mockResolvedValue({ id: 'c-1', userId: 'u-1' });

    await service.remove({ id: 'u-1', roles: ['USER'] }, 'c-1');

    expect(prisma.comment.update).toHaveBeenCalledWith({
      where: { id: 'c-1' },
      data: { deletedAt: expect.any(Date) as Date },
    });
  });

  it('bình luận đã xoá là 404, không phải thứ xoá được lần hai', async () => {
    const { service, prisma } = build();
    // getOwnedComment lọc kèm deletedAt: null, nên dòng đã xoá không tìm thấy.
    prisma.comment.findFirst.mockResolvedValue(null);

    await expect(
      service.remove({ id: 'u-1', roles: ['USER'] }, 'c-1'),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.comment.findFirst).toHaveBeenCalledWith({
      where: { id: 'c-1', deletedAt: null },
    });
  });

  it('chặn người khác xoá bình luận không phải của mình', async () => {
    const { service, prisma } = build();
    prisma.comment.findFirst.mockResolvedValue({ id: 'c-1', userId: 'u-2' });

    await expect(
      service.remove({ id: 'u-1', roles: ['USER'] }, 'c-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.comment.update).not.toHaveBeenCalled();
  });

  it('cho ADMIN gỡ bình luận của người khác', async () => {
    const { service, prisma } = build();
    prisma.comment.findFirst.mockResolvedValue({ id: 'c-1', userId: 'u-2' });

    await service.remove({ id: 'u-1', roles: ['ADMIN'] }, 'c-1');

    expect(prisma.comment.update).toHaveBeenCalled();
  });
});
