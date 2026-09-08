import 'dotenv/config';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppRole, resolveAppRole } from './common/app-role';

// Process việc nền: không mở cổng HTTP, chỉ chạy cron và tiêu thụ job trong queue.
//
// Dùng chung AppModule thay vì khai báo lại Config/I18n/Prisma/Redis: trong
// application context các controller vẫn được nạp nhưng không có HTTP server nào
// phục vụ chúng, nên không có route nào lộ ra từ process này.
async function bootstrap() {
  const logger = new Logger('Worker');
  const role = resolveAppRole();

  if (role === AppRole.API) {
    logger.error(
      'APP_ROLE=api — process này sẽ không chạy cron cũng không tiêu thụ job. Đặt APP_ROLE=worker.',
    );
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule);

  // SIGTERM (docker stop, deploy mới) → Nest gọi onModuleDestroy, BullMQ đóng
  // worker sau khi job đang chạy xong thay vì bỏ job giữa đường.
  app.enableShutdownHooks();

  if (process.env.MAIL_QUEUE_ENABLED !== 'true') {
    logger.warn(
      'MAIL_QUEUE_ENABLED khác true — worker chỉ chạy cron, mail vẫn được process API gửi trực tiếp.',
    );
  }

  logger.log(`Worker đang chạy (APP_ROLE=${role}), không mở cổng HTTP.`);
}

void bootstrap();
