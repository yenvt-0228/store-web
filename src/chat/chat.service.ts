import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { RoleName } from '../common/constants/role.constant';
import { Prisma } from '../generated/prisma/client';
import { paginated } from '../common/dto/paginated-response.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PrismaService } from '../prisma/prisma.service';
import {
  conversationInclude,
  messageInclude,
  toConversationResponse,
  toMessageResponse,
} from './dto/chat-response.dto';
import { ListMessageDto, SendMessageDto } from './dto/chat.dto';

/** Người gọi, đủ để quyết định họ được đụng vào hội thoại nào. */
export interface ChatActor {
  id: string;
  roles: string[];
}

export type MessageResponse = ReturnType<typeof toMessageResponse>;

@Injectable()
export class ChatService {
  constructor(
    private prisma: PrismaService,
    private i18n: I18nService,
  ) {}

  /**
   * Hội thoại của một khách, tạo nếu chưa có.
   *
   * Idempotent: gọi bao nhiêu lần cũng ra đúng một hội thoại, vì `userId` là
   * unique. Client bấm "chat với shop" hai lần không tạo ra hai kênh.
   *
   * @param userId - Khách đang mở hội thoại.
   * @returns Hội thoại của họ.
   */
  async openConversation(userId: string) {
    const { id } = await this.getOrCreateConversation(userId);

    const conversation = await this.prisma.conversation.findUniqueOrThrow({
      where: { id },
      include: conversationInclude,
    });

    return toConversationResponse(
      conversation,
      await this.unreadCountFor({ id: userId, roles: [] }, conversation.id),
    );
  }

  /**
   * Danh sách hội thoại.
   *
   * Khách chỉ thấy hội thoại của mình; admin thấy tất cả, hội thoại có tin mới
   * nhất lên đầu — đó là thứ tự một người trực chat cần.
   *
   * @param actor - Người gọi, kèm vai trò.
   * @param query - Trang và số dòng.
   * @returns Một trang hội thoại kèm số tin chưa đọc của người gọi.
   */
  async listConversations(actor: ChatActor, query: PaginationDto) {
    const where = this.isAdmin(actor) ? {} : { userId: actor.id };
    const { page = 1, limit = 10 } = query;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.conversation.findMany({
        where,
        skip: query.skip,
        take: limit,
        // nulls last: hội thoại vừa mở mà chưa ai nhắn thì chưa có gì để trả
        // lời, không nên chen lên trên hội thoại đang có tin chờ.
        orderBy: { lastMessageAt: { sort: 'desc', nulls: 'last' } },
        include: conversationInclude,
      }),
      this.prisma.conversation.count({ where }),
    ]);

    const unread = await this.unreadCounts(
      actor,
      rows.map((row) => row.id),
    );

    return paginated(
      rows.map((row) => toConversationResponse(row, unread.get(row.id) ?? 0)),
      total,
      page,
      limit,
    );
  }

  /**
   * Một trang tin nhắn của hội thoại, mới nhất trước.
   *
   * @param actor - Người gọi, kèm vai trò.
   * @param query - Hội thoại cần đọc, trang và số dòng.
   * @returns Một trang tin nhắn.
   * @throws {NotFoundException} Khi hội thoại không tồn tại.
   * @throws {ForbiddenException} Khi hội thoại thuộc về khách khác.
   */
  async listMessages(actor: ChatActor, query: ListMessageDto) {
    const conversation = await this.resolveConversation(
      actor,
      query.conversationId,
    );

    const where = { conversationId: conversation.id };
    const { page = 1, limit = 10 } = query;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.message.findMany({
        where,
        skip: query.skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: messageInclude,
      }),
      this.prisma.message.count({ where }),
    ]);

    return paginated(rows.map(toMessageResponse), total, page, limit);
  }

  /**
   * Gửi một tin nhắn.
   *
   * @param actor - Người gửi, kèm vai trò.
   * @param dto - Hội thoại đích và nội dung.
   * @returns Tin nhắn vừa tạo.
   * @throws {NotFoundException} Khi hội thoại không tồn tại.
   * @throws {ForbiddenException} Khi hội thoại thuộc về khách khác.
   */
  async sendMessage(
    actor: ChatActor,
    dto: SendMessageDto,
  ): Promise<MessageResponse> {
    const conversation = await this.resolveConversation(
      actor,
      dto.conversationId,
    );

    // Một transaction: tin nhắn và mốc lastMessageAt phải cùng đúng, nếu không
    // danh sách hội thoại của admin sẽ xếp sai thứ tự một cách vĩnh viễn.
    const [message] = await this.prisma.$transaction([
      this.prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderId: actor.id,
          content: dto.content,
        },
        include: messageInclude,
      }),
      this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date() },
      }),
    ]);

    return toMessageResponse(message);
  }

  /**
   * Đánh dấu một tin nhắn là đã đọc.
   *
   * @param actor - Người đọc, kèm vai trò.
   * @param messageId - Tin nhắn cần đánh dấu.
   * @returns Tin nhắn sau khi đánh dấu.
   * @throws {NotFoundException} Khi tin nhắn không tồn tại.
   * @throws {ForbiddenException} Khi tin thuộc hội thoại của khách khác, hoặc
   * do chính người gọi gửi.
   */
  async markRead(
    actor: ChatActor,
    messageId: string,
  ): Promise<MessageResponse> {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { ...messageInclude, conversation: true },
    });

    if (!message) {
      throw new NotFoundException(this.i18n.t('chat.MESSAGE_NOT_FOUND'));
    }

    this.assertCanAccess(actor, message.conversation.userId);

    // Tự đánh dấu tin của chính mình là "đã đọc" thì con số chưa đọc của phía
    // bên kia sai, và biên nhận gửi về là một lời nói dối.
    if (message.senderId === actor.id) {
      throw new ForbiddenException(this.i18n.t('chat.CANNOT_READ_OWN'));
    }

    // Đã đọc rồi thì giữ nguyên mốc cũ: đọc lại lần hai không làm tin nhắn
    // "mới được đọc" muộn hơn.
    if (message.readAt) {
      return toMessageResponse(message);
    }

    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: { readAt: new Date() },
      include: messageInclude,
    });

    return toMessageResponse(updated);
  }

  /**
   * Tìm hội thoại người gọi đang nói tới và chốt quyền.
   *
   * Khách bỏ trống `conversationId` thì lấy hội thoại của chính họ, tạo nếu
   * chưa có — bắt khách gọi một endpoint riêng trước khi nhắn được câu đầu
   * tiên là một vòng gọi thừa. Admin thì buộc phải nói rõ đang trả lời ai.
   *
   * @param actor - Người gọi, kèm vai trò.
   * @param conversationId - Hội thoại đích, có thể bỏ trống với khách.
   * @returns Hội thoại đã xác thực quyền.
   * @throws {NotFoundException} Khi không tìm thấy hội thoại.
   * @throws {ForbiddenException} Khi hội thoại thuộc về khách khác.
   */
  async resolveConversation(actor: ChatActor, conversationId?: string) {
    if (!conversationId) {
      if (this.isAdmin(actor)) {
        throw new NotFoundException(this.i18n.t('chat.CONVERSATION_REQUIRED'));
      }

      return this.getOrCreateConversation(actor.id);
    }

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new NotFoundException(this.i18n.t('chat.CONVERSATION_NOT_FOUND'));
    }

    this.assertCanAccess(actor, conversation.userId);

    return conversation;
  }

  /**
   * Lấy hội thoại của một khách, tạo nếu chưa có.
   *
   * Đọc-rồi-tạo thay vì `upsert`: `upsert` với `update: {}` trong Prisma 7 đi
   * thẳng vào INSERT và đâm vào unique index ngay lần gọi thứ hai — lỗi này chỉ
   * lộ ra khi chạy thật, vì mock nào cũng trả về dòng cũ một cách ngoan ngoãn.
   *
   * Nhánh catch không phải để cho đẹp: hai tab của cùng một khách cùng mở chat
   * thì cả hai đều đọc thấy "chưa có" rồi cùng tạo. Unique index chặn cái thứ
   * hai, và đọc lại là ra đúng hội thoại cái thứ nhất vừa tạo.
   *
   * @param userId - Khách sở hữu hội thoại.
   * @returns Hội thoại của họ.
   */
  private async getOrCreateConversation(userId: string) {
    const existing = await this.prisma.conversation.findUnique({
      where: { userId },
    });

    if (existing) {
      return existing;
    }

    try {
      return await this.prisma.conversation.create({ data: { userId } });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return this.prisma.conversation.findUniqueOrThrow({
          where: { userId },
        });
      }
      throw error;
    }
  }

  /**
   * @param actor - Người gọi.
   * @param conversationIds - Các hội thoại cần đếm.
   * @returns Số tin chưa đọc mà người gọi KHÔNG phải người gửi, theo hội thoại.
   */
  private async unreadCounts(actor: ChatActor, conversationIds: string[]) {
    if (conversationIds.length === 0) {
      return new Map<string, number>();
    }

    const groups = await this.prisma.message.groupBy({
      by: ['conversationId'],
      where: {
        conversationId: { in: conversationIds },
        readAt: null,
        // Tin do chính mình gửi không bao giờ là "chưa đọc" của mình.
        senderId: { not: actor.id },
      },
      _count: { _all: true },
    });

    return new Map(
      groups.map((group) => [group.conversationId, group._count._all]),
    );
  }

  private async unreadCountFor(actor: ChatActor, conversationId: string) {
    const counts = await this.unreadCounts(actor, [conversationId]);
    return counts.get(conversationId) ?? 0;
  }

  /**
   * @param actor - Người gọi.
   * @param ownerId - Chủ hội thoại.
   * @throws {ForbiddenException} Khi người gọi không phải chủ và không phải admin.
   */
  private assertCanAccess(actor: ChatActor, ownerId: string): void {
    if (ownerId !== actor.id && !this.isAdmin(actor)) {
      throw new ForbiddenException(this.i18n.t('chat.FORBIDDEN'));
    }
  }

  private isAdmin(actor: ChatActor): boolean {
    return actor.roles.includes(RoleName.ADMIN);
  }
}
