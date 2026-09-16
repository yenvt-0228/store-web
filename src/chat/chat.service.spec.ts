import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ChatService } from './chat.service';

const CUSTOMER = { id: 'u-1', roles: ['USER'] };
const OTHER = { id: 'u-2', roles: ['USER'] };
const ADMIN = { id: 'a-1', roles: ['ADMIN'] };

function message(overrides: Record<string, unknown> = {}) {
  return {
    id: 'm-1',
    conversationId: 'c-1',
    content: 'chào shop',
    senderId: 'u-1',
    readAt: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    sender: { id: 'u-1', name: 'Khách', avatar: null },
    conversation: { id: 'c-1', userId: 'u-1' },
    ...overrides,
  };
}

function build() {
  const prisma = {
    conversation: {
      findUnique: jest.fn().mockResolvedValue({ id: 'c-1', userId: 'u-1' }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: 'c-1',
        userId: 'u-1',
        lastMessageAt: null,
        createdAt: new Date(),
        user: { id: 'u-1', name: 'Khách', email: 'k@s.local', avatar: null },
      }),
      create: jest.fn().mockResolvedValue({ id: 'c-1', userId: 'u-1' }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn(),
    },
    message: {
      create: jest.fn().mockResolvedValue(message()),
      findUnique: jest.fn().mockResolvedValue(message()),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockResolvedValue(message({ readAt: new Date() })),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };

  const service = new ChatService(
    prisma as unknown as PrismaService,
    { t: (key: string) => key } as unknown as I18nService,
  );

  return { service, prisma };
}

describe('ChatService — phân quyền hội thoại', () => {
  it('khách không đụng được vào hội thoại của khách khác', async () => {
    const { service } = build(); // hội thoại c-1 thuộc về u-1

    await expect(
      service.resolveConversation(OTHER, 'c-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('admin vào được mọi hội thoại', async () => {
    const { service } = build();

    await expect(
      service.resolveConversation(ADMIN, 'c-1'),
    ).resolves.toMatchObject({ id: 'c-1' });
  });

  it('khách bỏ trống conversationId thì lấy hội thoại của chính mình', async () => {
    // Bắt khách gọi một endpoint riêng trước khi nhắn được câu đầu tiên là một
    // vòng gọi thừa.
    const { service, prisma } = build();

    await service.resolveConversation(CUSTOMER);

    expect(prisma.conversation.findUnique).toHaveBeenCalledWith({
      where: { userId: 'u-1' },
    });
  });

  it('admin bỏ trống conversationId thì bị từ chối — không có "hội thoại của admin"', async () => {
    const { service } = build();

    await expect(service.resolveConversation(ADMIN)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('danh sách của khách khoá theo userId, của admin thì không lọc', async () => {
    const { service, prisma } = build();

    await service.listConversations(CUSTOMER, {} as never);
    await service.listConversations(ADMIN, {} as never);

    const calls = prisma.conversation.findMany.mock.calls as [
      { where: Record<string, unknown> },
    ][];
    expect(calls[0][0].where).toEqual({ userId: 'u-1' });
    expect(calls[1][0].where).toEqual({});
  });
});

describe('ChatService.openConversation', () => {
  it('đã có hội thoại thì không tạo thêm', async () => {
    const { service, prisma } = build();

    await service.openConversation('u-1');
    await service.openConversation('u-1');

    expect(prisma.conversation.create).not.toHaveBeenCalled();
  });

  it('chưa có thì tạo mới', async () => {
    const { service, prisma } = build();
    prisma.conversation.findUnique.mockResolvedValue(null);

    await service.openConversation('u-1');

    expect(prisma.conversation.create).toHaveBeenCalledWith({
      data: { userId: 'u-1' },
    });
  });

  it('hai tab cùng tạo một lúc: đọc lại thay vì trả lỗi 409', async () => {
    // Cả hai đều đọc thấy "chưa có" rồi cùng tạo. Unique index chặn cái thứ
    // hai — và người dùng không được thấy lỗi vì chuyện đó.
    const { service, prisma } = build();
    prisma.conversation.findUnique.mockResolvedValue(null);
    prisma.conversation.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '7.9.0',
      }),
    );

    await expect(service.openConversation('u-1')).resolves.toMatchObject({
      id: 'c-1',
    });
    expect(prisma.conversation.findUniqueOrThrow).toHaveBeenCalled();
  });

  it('lỗi Prisma khác P2002 thì không nuốt', async () => {
    const { service, prisma } = build();
    prisma.conversation.findUnique.mockResolvedValue(null);
    prisma.conversation.create.mockRejectedValue(new Error('mất kết nối'));

    await expect(service.openConversation('u-1')).rejects.toThrow(
      'mất kết nối',
    );
  });
});

describe('ChatService.sendMessage', () => {
  it('ghi tin nhắn và mốc lastMessageAt trong cùng một transaction', async () => {
    // Hai thứ lệch nhau thì danh sách hội thoại của admin xếp sai vĩnh viễn.
    const { service, prisma } = build();

    await service.sendMessage(CUSTOMER, { content: 'chào shop' });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.message.create).toHaveBeenCalled();
    expect(prisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'c-1' } }),
    );
  });
});

describe('ChatService.markRead', () => {
  it('không cho tự đánh dấu tin của chính mình', async () => {
    // Con số chưa đọc của phía bên kia sẽ sai, và biên nhận gửi về là nói dối.
    const { service } = build(); // m-1 do u-1 gửi

    await expect(service.markRead(CUSTOMER, 'm-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('admin đánh dấu đã đọc tin của khách thì được', async () => {
    const { service, prisma } = build();

    await service.markRead(ADMIN, 'm-1');

    expect(prisma.message.update).toHaveBeenCalled();
  });

  it('đọc lại lần hai giữ nguyên mốc cũ', async () => {
    const readAt = new Date('2026-09-01T10:00:00Z');
    const { service, prisma } = build();
    prisma.message.findUnique.mockResolvedValue(message({ readAt }));

    const result = await service.markRead(ADMIN, 'm-1');

    expect(prisma.message.update).not.toHaveBeenCalled();
    expect(result.readAt).toBe(readAt);
  });

  it('khách khác không đánh dấu được tin trong hội thoại không phải của mình', async () => {
    const { service } = build();

    await expect(service.markRead(OTHER, 'm-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('404 khi tin nhắn không tồn tại', async () => {
    const { service, prisma } = build();
    prisma.message.findUnique.mockResolvedValue(null);

    await expect(service.markRead(ADMIN, 'm-404')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('ChatService — đếm tin chưa đọc', () => {
  it('không tính tin do chính mình gửi', async () => {
    const { service, prisma } = build();
    prisma.conversation.findMany.mockResolvedValue([
      {
        id: 'c-1',
        userId: 'u-1',
        lastMessageAt: new Date(),
        createdAt: new Date(),
        user: { id: 'u-1', name: 'Khách', email: 'k@s.local', avatar: null },
      },
    ]);

    await service.listConversations(ADMIN, {} as never);

    const calls = prisma.message.groupBy.mock.calls as [
      { where: { senderId: { not: string }; readAt: null } },
    ][];
    expect(calls[0][0].where.senderId).toEqual({ not: 'a-1' });
    expect(calls[0][0].where.readAt).toBeNull();
  });

  it('không có hội thoại nào thì không chạy truy vấn đếm', async () => {
    const { service, prisma } = build();

    await service.listConversations(ADMIN, {} as never);

    expect(prisma.message.groupBy).not.toHaveBeenCalled();
  });
});
