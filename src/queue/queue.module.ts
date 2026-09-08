import { BullModule } from '@nestjs/bullmq';
import { DynamicModule, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export function mailQueueEnabled(): boolean {
  return process.env.MAIL_QUEUE_ENABLED === 'true';
}

export function reportQueueEnabled(): boolean {
  return process.env.REPORT_QUEUE_ENABLED === 'true';
}

function anyQueueEnabled(): boolean {
  return mailQueueEnabled() || reportQueueEnabled();
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
              host: config.get<string>('REDIS_HOST') ?? '127.0.0.1',
              port: Number(config.get<string>('REDIS_PORT') ?? 6379),
              password: config.get<string>('REDIS_PASSWORD') || undefined,
              db: Number(config.get<string>('REDIS_DB') ?? 0),
              // BullMQ requires null for the worker's blocking commands.
              maxRetriesPerRequest: null,
            },
          }),
        }),
      ],
    };
  }
}
