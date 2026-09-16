import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { AuthUser } from '../auth/current-user.decorator';
import { RoleName } from '../common/constants/role.constant';
import {
  ADMIN_ROOM,
  CHAT_NAMESPACE,
  ChatEvent,
  conversationRoom,
} from './chat.constant';
import { ChatService } from './chat.service';
import type { MessageResponse } from './chat.service';
import { WsAuthService } from './ws-auth.service';

/** Những gì gateway gắn lên socket sau khi bắt tay. */
interface ChatSocketData {
  user?: AuthUser;
}

/**
 * Đọc/ghi `socket.data` qua một chỗ duy nhất.
 *
 * `Socket.data` được socket.io khai là `any`, nên mỗi lần chạm vào là một lần
 * tin vào thứ không ai kiểm. Gom phép ép kiểu về đây thì chỉ còn đúng một dòng
 * cần đọc kỹ, thay vì rải khắp gateway.
 *
 * @param socket - Socket cần đọc.
 * @returns Túi dữ liệu của socket, đã có kiểu.
 */
function dataOf(socket: Socket): ChatSocketData {
  return socket.data as ChatSocketData;
}

/**
 * Kênh thời gian thực của chat.
 *
 * Cố ý KHÔNG nhận tin nhắn gửi lên qua socket: gửi tin đi qua `POST
 * /chat/messages`, còn socket chỉ để đẩy xuống. Một đường ghi duy nhất nghĩa là
 * một chỗ duy nhất áp validation, phân quyền và transaction — có thêm đường ghi
 * thứ hai là phải chép lại toàn bộ những thứ đó.
 *
 * Gateway chỉ chạy ở process API. Process worker không mở cổng nào
 * (`createApplicationContext`), nên một gateway ở đó là thứ không ai gọi tới.
 */
@WebSocketGateway({
  namespace: CHAT_NAMESPACE,
  cors: { origin: process.env.FRONTEND_URL ?? true, credentials: true },
})
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly auth: WsAuthService,
    private readonly chat: ChatService,
  ) {}

  /**
   * Chặn xác thực ngay ở tầng middleware của socket.io.
   *
   * Đặt ở đây chứ không phải trong `handleConnection`: middleware chạy TRƯỚC
   * khi kết nối được chấp nhận, nên client mang token hỏng nhận thẳng
   * `connect_error` và không bao giờ tồn tại như một socket đã nối. Làm ở
   * `handleConnection` thì socket đã nối xong rồi mới bị ngắt — nó có thật
   * trong một khoảnh khắc, và một socket có thật là một socket nhận được
   * broadcast nếu sau này ai đó lỡ phát ra toàn namespace.
   *
   * @param server - Namespace socket.io mà Nest vừa dựng.
   */
  afterInit(server: Server): void {
    server.use((socket, next) => {
      this.auth
        .authenticate(socket)
        .then((user) => {
          if (!user) {
            next(new Error('unauthorized'));
            return;
          }

          dataOf(socket).user = user;
          next();
        })
        .catch((error: Error) => next(error));
    });
  }

  /**
   * Cho socket đã xác thực vào đúng phòng.
   *
   * @param socket - Socket vừa qua được middleware.
   */
  async handleConnection(socket: Socket): Promise<void> {
    const user = dataOf(socket).user;

    if (!user) {
      // Middleware đáng lẽ đã chặn. Tới được đây nghĩa là có gì đó sai, và câu
      // trả lời an toàn là ngắt chứ không phải phục vụ tiếp.
      socket.disconnect(true);
      return;
    }

    if (user.roles.includes(RoleName.ADMIN)) {
      // Admin vào phòng chung để biết có tin mới ở hội thoại họ chưa mở.
      await socket.join(ADMIN_ROOM);
    } else {
      const conversation = await this.chat.resolveConversation({
        id: user.id,
        roles: user.roles,
      });
      await socket.join(conversationRoom(conversation.id));
    }

    this.logger.debug(`Socket ${socket.id} đã vào: user ${user.id}`);
  }

  handleDisconnect(socket: Socket): void {
    // socket.io tự rời mọi phòng khi ngắt; ở đây chỉ ghi log.
    this.logger.debug(
      `Socket ${socket.id} rời đi (user ${dataOf(socket).user?.id ?? '?'})`,
    );
  }

  /**
   * Đẩy một tin nhắn mới tới những người đang mở hội thoại đó.
   *
   * Gọi từ `ChatController` sau khi ghi DB xong, nên tin đã nằm trong DB trước
   * khi ai đó nhìn thấy nó — người nhận tải lại trang là thấy đúng thứ vừa hiện
   * ra, không phải một tin nhắn biến mất.
   *
   * @param message - Tin nhắn đã lưu.
   */
  emitMessage(message: MessageResponse): void {
    this.to(conversationRoom(message.conversationId)).emit(
      ChatEvent.MESSAGE_CREATED,
      message,
    );
    this.to(ADMIN_ROOM).emit(ChatEvent.MESSAGE_CREATED, message);
  }

  /**
   * @param message - Tin nhắn vừa được đánh dấu đã đọc.
   */
  emitRead(message: MessageResponse): void {
    this.to(conversationRoom(message.conversationId)).emit(
      ChatEvent.MESSAGE_READ,
      message,
    );
    this.to(ADMIN_ROOM).emit(ChatEvent.MESSAGE_READ, message);
  }

  /**
   * Phát vào một phòng, chịu được việc server chưa sẵn sàng.
   *
   * `@WebSocketServer()` chỉ được gán sau khi Nest khởi tạo gateway. Một lời
   * gọi sớm hơn thế — hoặc trong unit test — không được phép làm hỏng request
   * đã ghi DB thành công: tin nhắn đã lưu rồi, mất phần đẩy realtime chỉ là
   * client phải tự tải lại.
   */
  private to(room: string) {
    return (
      this.server?.to(room) ?? {
        emit: () => {
          this.logger.warn(
            `Socket server chưa sẵn sàng, bỏ qua sự kiện gửi tới ${room}.`,
          );
          return false;
        },
      }
    );
  }
}
