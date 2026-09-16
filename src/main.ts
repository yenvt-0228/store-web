import 'dotenv/config';

import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { I18nValidationPipe } from 'nestjs-i18n';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';
import { ValidationExceptionFilter } from './common/filters/validation-exception.filter';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { RedisIoAdapter } from './chat/redis-io.adapter';
import { AppRole, resolveAppRole } from './common/app-role';
import {
  GRPC_DEFAULT_URL,
  GRPC_LOADER_OPTIONS,
  GRPC_PACKAGE,
  GRPC_PROTO_PATHS,
  grpcEnabled,
} from './grpc/grpc.constant';

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

  // socket.io giữ danh sách phòng trong bộ nhớ của từng process, nên hai replica
  // là hai thế giới tách rời: khách nối vào replica này, admin nối vào replica
  // kia, không ai thấy tin của ai. Adapter Redis nối chúng lại qua pub/sub.
  const ioAdapter = await RedisIoAdapter.create(app);
  if (ioAdapter) {
    app.useWebSocketAdapter(ioAdapter);
  }

  // A hybrid application: one process, two transports. HTTP keeps serving the
  // browser — gRPC cannot reach one — while the gRPC port answers other
  // services. They share the container, so a handler on either side talks to
  // the same providers, the same Prisma pool and the same Redis connection.
  if (grpcEnabled()) {
    const url = configService.get<string>('GRPC_URL') ?? GRPC_DEFAULT_URL;

    app.connectMicroservice<MicroserviceOptions>(
      {
        transport: Transport.GRPC,
        options: {
          package: GRPC_PACKAGE,
          protoPath: GRPC_PROTO_PATHS,
          url,
          loader: GRPC_LOADER_OPTIONS,
        },
      },
      // The gRPC handlers reuse the domain services, which throw
      // HttpException — inheritAppConfig would also apply the global HTTP
      // filters to them, and those write an HTTP body into a gRPC reply.
      // GrpcExceptionFilter is bound per controller instead.
      { inheritAppConfig: false },
    );

    await app.startAllMicroservices();
    console.log(`gRPC listening on ${url} (internal only — never publish it)`);
  }

  const port = configService.get<number>('PORT') ?? 3000;

  await app.listen(port, '0.0.0.0');

  console.log(`Server running on http://localhost:${port} (APP_ROLE=${role})`);
}

void bootstrap();
