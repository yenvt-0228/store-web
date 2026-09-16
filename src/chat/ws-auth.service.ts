import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Socket } from 'socket.io';
import type { AuthUser } from '../auth/current-user.decorator';
import { JwtPayload, JwtStrategy } from '../auth/jwt.strategy';

/**
 * Xác thực một socket lúc bắt tay.
 *
 * `JwtAuthGuard` chạy trên HTTP request và không với tới đây được: socket
 * không có header cho từng sự kiện, chỉ có một lần bắt tay ban đầu. Nhưng luật
 * thì phải y hệt — chữ ký, hạn dùng, rồi tài khoản còn tồn tại / chưa bị khoá /
 * đã kích hoạt. Ba vế sau là `JwtStrategy.validate`, dùng lại chứ không viết
 * lại: một bản sao là một chỗ để quên sửa khi luật đổi.
 */
@Injectable()
export class WsAuthService {
  private readonly logger = new Logger(WsAuthService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly strategy: JwtStrategy,
  ) {}

  /**
   * @param socket - Socket vừa kết nối.
   * @returns Người dùng đứng sau socket, hoặc `null` khi token không hợp lệ.
   */
  async authenticate(socket: Socket): Promise<AuthUser | null> {
    const token = extractToken(socket);

    if (!token) {
      return null;
    }

    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      return await this.strategy.validate(payload);
    } catch (error) {
      // Lý do không gửi cho client: "hết hạn" và "sai chữ ký" là hai sự thật
      // khác nhau, và chỉ một trong hai là an toàn để nói ra.
      this.logger.debug(
        `Từ chối socket ${socket.id}: ${(error as Error).message}`,
      );
      return null;
    }
  }
}

/**
 * Đọc token từ chỗ client đặt nó.
 *
 * Nhận cả ba dạng vì mỗi client socket.io đặt một chỗ: `auth` là chỗ đúng và
 * được khuyến nghị, `Authorization` header dành cho client dùng transport
 * polling, còn query string là lối cuối — nó lọt vào log của proxy nên chỉ giữ
 * để tương thích.
 *
 * @param socket - Socket vừa kết nối.
 * @returns Token thô, hoặc `null`.
 */
function extractToken(socket: Socket): string | null {
  const handshake = socket.handshake;

  const fromAuth = (handshake.auth as { token?: unknown } | undefined)?.token;
  if (typeof fromAuth === 'string' && fromAuth.length > 0) {
    return stripBearer(fromAuth);
  }

  const header = handshake.headers.authorization;
  if (typeof header === 'string' && header.length > 0) {
    return stripBearer(header);
  }

  const fromQuery = handshake.query?.token;
  if (typeof fromQuery === 'string' && fromQuery.length > 0) {
    return stripBearer(fromQuery);
  }

  return null;
}

function stripBearer(value: string): string {
  return value.startsWith('Bearer ') ? value.slice(7) : value;
}
