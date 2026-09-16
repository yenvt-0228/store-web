/** Namespace của socket. Tách khỏi "/" để sau này thêm kênh khác không đụng nhau. */
export const CHAT_NAMESPACE = '/chat';

/** Sự kiện server phát ra. */
export const ChatEvent = {
  MESSAGE_CREATED: 'message.created',
  MESSAGE_READ: 'message.read',
} as const;

/**
 * Tên phòng của một hội thoại.
 *
 * Mọi tin nhắn đều phát vào phòng chứ không phát tới từng socket: một người có
 * thể mở nhiều tab, và admin thì có nhiều người cùng trực.
 *
 * @param conversationId - Id hội thoại.
 * @returns Tên phòng socket.io.
 */
export function conversationRoom(conversationId: string): string {
  return `conversation:${conversationId}`;
}

/**
 * Phòng chung của đội admin.
 *
 * Admin cần biết có hội thoại mới hoặc tin mới ở hội thoại họ CHƯA mở, nên
 * ngoài phòng của từng hội thoại còn phải có một phòng gom tất cả.
 */
export const ADMIN_ROOM = 'admins';
