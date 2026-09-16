import { Prisma } from '../../generated/prisma/client';

export const messageInclude = {
  sender: { select: { id: true, name: true, avatar: true } },
} satisfies Prisma.MessageInclude;

export const conversationInclude = {
  user: { select: { id: true, name: true, email: true, avatar: true } },
} satisfies Prisma.ConversationInclude;

type MessagePayload = Prisma.MessageGetPayload<{
  include: typeof messageInclude;
}>;
type ConversationPayload = Prisma.ConversationGetPayload<{
  include: typeof conversationInclude;
}>;

export function toMessageResponse(message: MessagePayload) {
  return {
    id: message.id,
    conversationId: message.conversationId,
    content: message.content,
    sender: message.sender,
    readAt: message.readAt,
    createdAt: message.createdAt,
  };
}

export function toConversationResponse(
  conversation: ConversationPayload,
  unreadCount: number,
) {
  return {
    id: conversation.id,
    customer: conversation.user,
    lastMessageAt: conversation.lastMessageAt,
    unreadCount,
    createdAt: conversation.createdAt,
  };
}
