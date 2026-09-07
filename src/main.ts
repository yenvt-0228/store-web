import 'dotenv/config';

import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { I18nValidationPipe } from 'nestjs-i18n';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';
import { ValidationExceptionFilter } from './common/filters/validation-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // I18nValidationPipe: giống ValidationPipe nhưng message lỗi dịch được theo ngôn ngữ
  app.useGlobalPipes(
    new I18nValidationPipe({
      whitelist: true, // loại field lạ không khai báo trong DTO
      transform: true, // ép kiểu dữ liệu về đúng kiểu trong DTO
    }),
  );

  // HttpExceptionFilter: cho 401/403/404/409...
  // ValidationExceptionFilter: cho lỗi validation (kèm dịch i18n)
  // PrismaExceptionFilter: lỗi database lọt lưới (P2002 unique, P2025 not found)
  app.useGlobalFilters(
    new HttpExceptionFilter(),
    new ValidationExceptionFilter({ detailedErrors: false }),
    new PrismaExceptionFilter(),
  );

  // Cấu hình Swagger — trang tài liệu API
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Store API')
    .setDescription('API web bán hàng — NestJS + Prisma + Redis')
    .setVersion('1.0')
    .addBearerAuth() // hiện nút "Authorize" để nhập JWT token
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document); // tài liệu tại /docs

  const configService = app.get(ConfigService);

  const port = configService.get<number>('PORT') ?? 3000;

  await app.listen(port, '0.0.0.0');

  console.log(`Server running on http://localhost:${port}`);
}

void bootstrap();
