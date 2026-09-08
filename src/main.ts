import 'dotenv/config';

import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { I18nValidationPipe } from 'nestjs-i18n';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';
import { ValidationExceptionFilter } from './common/filters/validation-exception.filter';
import { AppRole, resolveAppRole } from './common/app-role';

/**
 * Boots the HTTP process: global pipes and filters, Swagger docs, then listen.
 *
 * @returns Resolves once the server is listening, or immediately with a
 * non-zero `process.exitCode` when `APP_ROLE=worker` is misconfigured here.
 */
async function bootstrap() {
  const role = resolveAppRole();

  // main.ts is the HTTP process entry point. APP_ROLE=worker here is a
  // misconfiguration: the process would serve requests and run cron at the same
  // time, which is exactly what the split avoids.
  if (role === AppRole.WORKER) {
    console.error(
      'APP_ROLE=worker but this is the HTTP entry point — use "npm run start:worker" (dist/main.worker.js).',
    );
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.create(AppModule);

  // Close Prisma/Redis/queue cleanly on the SIGTERM of a new deploy.
  app.enableShutdownHooks();

  // I18nValidationPipe behaves like ValidationPipe, but its error messages are
  // translated to the language of the request.
  app.useGlobalPipes(
    new I18nValidationPipe({
      whitelist: true, // drop fields the DTO does not declare
      transform: true, // coerce payload values to the DTO types
    }),
  );

  // HttpExceptionFilter: 401/403/404/409 and friends.
  // ValidationExceptionFilter: validation errors, translated through i18n.
  // PrismaExceptionFilter: database errors that slipped through
  // (P2002 unique constraint, P2025 record not found).
  app.useGlobalFilters(
    new HttpExceptionFilter(),
    new ValidationExceptionFilter({ detailedErrors: false }),
    new PrismaExceptionFilter(),
  );

  // Swagger configuration for the API documentation page.
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Store API')
    .setDescription('API web bán hàng — NestJS + Prisma + Redis')
    .setVersion('1.0')
    .addBearerAuth() // shows the "Authorize" button for pasting a JWT
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document); // documentation served at /docs

  const configService = app.get(ConfigService);

  const port = configService.get<number>('PORT') ?? 3000;

  await app.listen(port, '0.0.0.0');

  console.log(`Server running on http://localhost:${port} (APP_ROLE=${role})`);
}

void bootstrap();
