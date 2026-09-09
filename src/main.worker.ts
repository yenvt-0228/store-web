import 'dotenv/config';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppRole, resolveAppRole } from './common/app-role';

/**
 * Boots the background process: opens no HTTP port, only runs cron jobs and
 * consumes the queues.
 *
 * It reuses `AppModule` instead of redeclaring Config/I18n/Prisma/Redis: in an
 * application context the controllers are still instantiated but no HTTP server
 * serves them, so this process exposes no routes.
 *
 * @returns Resolves once the context is up, or immediately with a non-zero
 * `process.exitCode` when `APP_ROLE=api` leaves nothing for the worker to do.
 */
async function bootstrap() {
  const logger = new Logger('Worker');
  const role = resolveAppRole();

  if (role === AppRole.API) {
    logger.error(
      'APP_ROLE=api — this process would run no cron and consume no job. Set APP_ROLE=worker.',
    );
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule);

  // SIGTERM (docker stop, a new deploy) -> Nest calls onModuleDestroy and
  // BullMQ closes the worker after the running job finishes rather than
  // dropping it half way.
  app.enableShutdownHooks();

  if (process.env.MAIL_QUEUE_ENABLED !== 'true') {
    logger.warn(
      'MAIL_QUEUE_ENABLED is not true — the worker only runs cron; the API process keeps sending mail directly.',
    );
  }

  logger.log(`Worker is running (APP_ROLE=${role}), no HTTP port opened.`);
}

void bootstrap();
