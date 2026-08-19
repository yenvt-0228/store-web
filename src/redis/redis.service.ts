import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(private config: ConfigService) {
    this.client = new Redis({
      host: this.config.get<string>('REDIS_HOST') ?? '127.0.0.1',
      port: Number(this.config.get<string>('REDIS_PORT') ?? 6379),
      password: this.config.get<string>('REDIS_PASSWORD') || undefined,
      db: Number(this.config.get<string>('REDIS_DB') ?? 0),
      lazyConnect: true,
      retryStrategy: (times) => (times > 3 ? null : times * 200),
      maxRetriesPerRequest: 2,
    });

    this.client.on('error', (error: Error) => {
      this.logger.warn(`Redis lỗi: ${error.message}`);
    });
  }

  async ensureConnected(): Promise<void> {
    if (this.client.status === 'end' || this.client.status === 'wait') {
      await this.client.connect();
    }
  }

  async isAlive(): Promise<boolean> {
    try {
      await this.ensureConnected();
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.status === 'wait') {
      this.client.disconnect();
      return;
    }
    await this.client.quit().catch(() => this.client.disconnect());
  }
}
