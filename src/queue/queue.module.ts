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

// Kết nối Redis dùng chung cho mọi queue. `BullModule.forRoot` đăng ký config ở
// phạm vi global, nên module nào chỉ cần `registerQueue` là dùng lại được — không
// module nào tự mở kết nối riêng nữa.
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
              // BullMQ yêu cầu null cho các lệnh blocking của worker.
              maxRetriesPerRequest: null,
            },
          }),
        }),
      ],
    };
  }
}
