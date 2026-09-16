import { JwtService } from '@nestjs/jwt';
import type { Socket } from 'socket.io';
import { JwtStrategy } from '../auth/jwt.strategy';
import { WsAuthService } from './ws-auth.service';

const USER = { id: 'u-1', email: 'a@s.local', roles: ['USER'] };

function socketWith(handshake: Record<string, unknown>): Socket {
  return {
    id: 'sock-1',
    handshake: { auth: {}, headers: {}, query: {}, ...handshake },
  } as unknown as Socket;
}

function build() {
  const verifyAsync = jest.fn().mockResolvedValue({ sub: 'u-1' });
  const validate = jest.fn().mockResolvedValue(USER);

  const service = new WsAuthService(
    { verifyAsync } as unknown as JwtService,
    { validate } as unknown as JwtStrategy,
  );
  jest.spyOn(service['logger'], 'debug').mockImplementation(() => undefined);

  return { service, verifyAsync, validate };
}

describe('WsAuthService.authenticate', () => {
  it('đọc token từ handshake.auth — chỗ đúng của socket.io', async () => {
    const { service, verifyAsync } = build();

    const user = await service.authenticate(
      socketWith({ auth: { token: 'abc' } }),
    );

    expect(verifyAsync).toHaveBeenCalledWith('abc');
    expect(user).toEqual(USER);
  });

  it('chấp nhận cả header Authorization cho client dùng polling', async () => {
    const { service, verifyAsync } = build();

    await service.authenticate(
      socketWith({ headers: { authorization: 'Bearer abc' } }),
    );

    expect(verifyAsync).toHaveBeenCalledWith('abc');
  });

  it('bóc tiền tố Bearer ở mọi nguồn', async () => {
    const { service, verifyAsync } = build();

    await service.authenticate(socketWith({ auth: { token: 'Bearer abc' } }));

    expect(verifyAsync).toHaveBeenCalledWith('abc');
  });

  it('chạy tiếp qua JwtStrategy.validate, không dừng ở chữ ký', async () => {
    // Chữ ký hợp lệ chưa đủ: tài khoản có thể đã bị khoá hoặc chưa kích hoạt
    // sau khi token được cấp.
    const { service, validate } = build();

    await service.authenticate(socketWith({ auth: { token: 'abc' } }));

    expect(validate).toHaveBeenCalledWith({ sub: 'u-1' });
  });

  it('tài khoản bị khoá thì từ chối, dù token còn hạn', async () => {
    const { service, validate } = build();
    validate.mockRejectedValue(new Error('ACCOUNT_INACTIVE'));

    await expect(
      service.authenticate(socketWith({ auth: { token: 'abc' } })),
    ).resolves.toBeNull();
  });

  it('không có token thì null, và không gọi tới JWT', async () => {
    const { service, verifyAsync } = build();

    await expect(service.authenticate(socketWith({}))).resolves.toBeNull();
    expect(verifyAsync).not.toHaveBeenCalled();
  });

  it('token sai thì null chứ không ném lỗi ra ngoài', async () => {
    const { service, verifyAsync } = build();
    verifyAsync.mockRejectedValue(new Error('jwt malformed'));

    await expect(
      service.authenticate(socketWith({ auth: { token: 'rác' } })),
    ).resolves.toBeNull();
  });
});
