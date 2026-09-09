import { BullModule } from '@nestjs/bullmq';
import { DynamicModule, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RedisOptions } from 'bullmq';

export function mailQueueEnabled(): boolean {
  return process.env.MAIL_QUEUE_ENABLED === 'true';
}

export function reportQueueEnabled(): boolean {
  return process.env.REPORT_QUEUE_ENABLED === 'true';
}

function anyQueueEnabled(): boolean {
  return mailQueueEnabled() || reportQueueEnabled();
}

/**
 * Builds the Redis connection options for BullMQ.
 *
 * `REDIS_URL` wins over the four separate variables, the same rule RedisService
 * follows and the one `.env.example` documents: a managed provider (Render,
 * Upstash) hands out a URL only, and reading just REDIS_HOST would silently
 * point every queue at 127.0.0.1 — where nothing answers, so no job ever runs.
 *
 * @param config - Configuration holding the Redis variables.
 * @returns Either `{ url }`, which BullMQ passes straight to ioredis, or the
 * host/port/password/db quadruple.
 */
export function redisConnection(config: ConfigService): RedisOptions {
  const url = config.get<string>('REDIS_URL');

  if (url) {
    return { url };
  }

  return {
    host: config.get<string>('REDIS_HOST') ?? '127.0.0.1',
    port: Number(config.get<string>('REDIS_PORT') ?? 6379),
    password: config.get<string>('REDIS_PASSWORD') || undefined,
    db: Number(config.get<string>('REDIS_DB') ?? 0),
  };
}

// Redis connection shared by every queue. `BullModule.forRoot` registers the
// config globally, so any module only needs `registerQueue` to reuse it and no
// module opens a connection of its own any more.
@Module({})
export class QueueModule {
  static register(): DynamicModule {
    if (!anyQueueEnabled()) {
      return { module: QueueModule };
    }

    return {
      module: QueueModule,
      imports: [
        BullModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            connection: {
              // BullMQ requires null for the worker's blocking commands.
              maxRetriesPerRequest: null,
              ...redisConnection(config),
            },
          }),
        }),
      ],
    };
  }
}
