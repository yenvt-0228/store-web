import { BullModule } from '@nestjs/bullmq';
import { DynamicModule, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MAIL_QUEUE } from './mail.constant';
import { MailDispatcher } from './mail.dispatcher';
import { MailListener } from './mail.listener';
import { MailProcessor } from './mail.processor';
import { MailRenderer } from './mail.renderer';
import { MailService } from './mail.service';

@Module({})
export class MailModule {
  static register(): DynamicModule {
    const queueEnabled = process.env.MAIL_QUEUE_ENABLED === 'true';

    return {
      module: MailModule,
      imports: queueEnabled
        ? [
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
            BullModule.registerQueue({ name: MAIL_QUEUE }),
          ]
        : [],
      providers: [
        MailService,
        MailDispatcher,
        MailRenderer,
        MailListener,
        ...(queueEnabled ? [MailProcessor] : []),
      ],
      exports: [MailDispatcher],
    };
  }
}
