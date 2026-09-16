import { INestApplicationContext, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { ServerOptions } from 'socket.io';
import { RedisService } from '../redis/redis.service';

/**
 * Cho socket.io dùng Redis pub/sub để nối các replica lại với nhau.
 *
 * Không có nó thì mọi thứ vẫn "chạy" trên máy dev một process, và hỏng đúng lúc
 * lên production nhiều replica: khách nối vào replica A, admin nối vào replica
 * B, mỗi bên phát vào bộ nhớ của riêng mình và không ai thấy tin của ai. Đó là
 * kiểu lỗi chỉ hiện ra khi scale, nên phải xử lý từ đầu.
 */
export class RedisIoAdapter extends IoAdapter {
  private static readonly logger = new Logger(RedisIoAdapter.name);

  private constructor(
    app: INestApplicationContext,
    private readonly adapterConstructor: ReturnType<typeof createAdapter>,
  ) {
    super(app);
  }

  /**
   * Dựng adapter, hoặc trả `null` khi không nối được Redis.
   *
   * `null` chứ không ném lỗi: chat mất tính năng xuyên-replica còn hơn cả API
   * không khởi động nổi vì Redis đang bảo trì. Gọi bên gọi tự quyết định.
   *
   * @param app - Ứng dụng Nest đã khởi tạo xong.
   * @returns Adapter đã sẵn sàng, hoặc `null`.
   */
  static async create(
    app: INestApplicationContext,
  ): Promise<RedisIoAdapter | null> {
    const redis = app.get(RedisService, { strict: false });

    try {
      await redis.ensureConnected();

      // Hai kết nối riêng, không dùng lại `redis.client`: một kết nối đang ở
      // chế độ subscribe thì Redis chỉ cho chạy lệnh subscribe trên đó — mọi
      // lệnh GET/SET khác của ứng dụng sẽ hỏng.
      const pubClient = redis.client.duplicate();
      const subClient = redis.client.duplicate();

      await Promise.all([pubClient.connect(), subClient.connect()]);

      return new RedisIoAdapter(app, createAdapter(pubClient, subClient));
    } catch (error) {
      RedisIoAdapter.logger.warn(
        `Không nối được Redis cho socket.io (${(error as Error).message}) — ` +
          'chat chỉ hoạt động trong phạm vi một process.',
      );
      return null;
    }
  }

  createIOServer(port: number, options?: ServerOptions): unknown {
    const server = super.createIOServer(port, options) as {
      adapter: (factory: unknown) => void;
    };
    server.adapter(this.adapterConstructor);

    return server;
  }
}
