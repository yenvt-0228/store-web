import type { Socket } from 'socket.io';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { WsAuthService } from './ws-auth.service';
import { ADMIN_ROOM, ChatEvent, conversationRoom } from './chat.constant';

// Trả các jest.fn() ra ngoài thay vì để test với vào `socket.join`: lôi một
// method ra khỏi object rồi truyền đi là đúng cái `unbound-method` cảnh báo.
function fakeSocket() {
  const join = jest.fn().mockResolvedValue(undefined);
  const emit = jest.fn();
  const disconnect = jest.fn();

  const socket = {
    id: 'sock-1',
    data: {},
    join,
    emit,
    disconnect,
  } as unknown as Socket;

  return { socket, join, emit, disconnect };
}

function build() {
  const authenticate = jest.fn();
  const resolveConversation = jest
    .fn()
    .mockResolvedValue({ id: 'c-1', userId: 'u-1' });

  const gateway = new ChatGateway(
    { authenticate } as unknown as WsAuthService,
    { resolveConversation } as unknown as ChatService,
  );
  jest.spyOn(gateway['logger'], 'debug').mockImplementation(() => undefined);
  jest.spyOn(gateway['logger'], 'warn').mockImplementation(() => undefined);

  return { gateway, authenticate, resolveConversation };
}

/** Chạy middleware mà `afterInit` đăng ký, rồi trả về lỗi nó chuyển cho next(). */
async function runMiddleware(
  gateway: ChatGateway,
  socket: Socket,
): Promise<Error | undefined> {
  let registered!: (s: Socket, next: (err?: Error) => void) => void;
  gateway.afterInit({
    use: (fn: (s: Socket, next: (err?: Error) => void) => void) => {
      registered = fn;
    },
  } as unknown as Parameters<ChatGateway['afterInit']>[0]);

  return new Promise<Error | undefined>((resolve) => {
    registered(socket, resolve);
  });
}

describe('ChatGateway — middleware xác thực', () => {
  it('chặn token hỏng TRƯỚC khi kết nối được chấp nhận', async () => {
    // Chặn ở handleConnection thì socket đã nối xong rồi mới bị ngắt — nó có
    // thật trong một khoảnh khắc, và một socket có thật là một socket nhận
    // được broadcast.
    const { gateway, authenticate } = build();
    authenticate.mockResolvedValue(null);
    const { socket } = fakeSocket();

    const error = await runMiddleware(gateway, socket);

    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toBe('unauthorized');
  });

  it('cho qua và gắn user lên socket khi token hợp lệ', async () => {
    const { gateway, authenticate } = build();
    const user = { id: 'u-1', roles: ['USER'] };
    authenticate.mockResolvedValue(user);
    const { socket } = fakeSocket();

    const error = await runMiddleware(gateway, socket);

    expect(error).toBeUndefined();
    expect((socket.data as { user?: unknown }).user).toEqual(user);
  });
});

describe('ChatGateway.handleConnection', () => {
  it('ngắt socket nào lọt qua được mà không có user', async () => {
    const { gateway } = build();
    const { socket, join, disconnect } = fakeSocket();

    await gateway.handleConnection(socket);

    expect(disconnect).toHaveBeenCalledWith(true);
    expect(join).not.toHaveBeenCalled();
  });

  it('khách vào phòng hội thoại của chính mình', async () => {
    const { gateway } = build();
    const { socket, join } = fakeSocket();
    (socket.data as { user?: unknown }).user = { id: 'u-1', roles: ['USER'] };

    await gateway.handleConnection(socket);

    expect(join).toHaveBeenCalledWith(conversationRoom('c-1'));
    expect(join).not.toHaveBeenCalledWith(ADMIN_ROOM);
  });

  it('admin vào phòng chung, không vào phòng hội thoại nào', async () => {
    // Admin cần biết có tin mới ở hội thoại họ CHƯA mở.
    const { gateway, resolveConversation } = build();
    const { socket, join } = fakeSocket();
    (socket.data as { user?: unknown }).user = { id: 'a-1', roles: ['ADMIN'] };

    await gateway.handleConnection(socket);

    expect(join).toHaveBeenCalledWith(ADMIN_ROOM);
    expect(resolveConversation).not.toHaveBeenCalled();
  });
});

describe('ChatGateway — phát sự kiện', () => {
  const message = {
    id: 'm-1',
    conversationId: 'c-1',
    content: 'chào',
    sender: { id: 'u-1', name: 'Khách', avatar: null },
    readAt: null,
    createdAt: new Date(),
  };

  it('phát tới cả phòng hội thoại lẫn phòng admin', () => {
    const { gateway } = build();
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    (gateway as unknown as { server: unknown }).server = { to };

    gateway.emitMessage(message);

    expect(to).toHaveBeenCalledWith(conversationRoom('c-1'));
    expect(to).toHaveBeenCalledWith(ADMIN_ROOM);
    expect(emit).toHaveBeenCalledWith(ChatEvent.MESSAGE_CREATED, message);
  });

  it('server chưa sẵn sàng thì không làm hỏng request đã ghi DB xong', () => {
    // Tin nhắn đã lưu rồi; mất phần đẩy realtime chỉ là client phải tự tải lại.
    const { gateway } = build();

    expect(() => gateway.emitMessage(message)).not.toThrow();
    expect(() => gateway.emitRead(message)).not.toThrow();
  });
});
