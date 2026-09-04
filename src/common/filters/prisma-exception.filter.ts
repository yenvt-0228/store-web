import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { I18nContext } from 'nestjs-i18n';
import { Prisma } from '../../generated/prisma/client';

@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const i18n = I18nContext.current();
    const t = (key: string, fallback: string): string =>
      i18n?.t(key) ?? fallback;

    switch (exception.code) {
      // Ghi trùng giá trị của cột @unique.
      case 'P2002':
        return this.send(
          res,
          HttpStatus.CONFLICT,
          t('common.ALREADY_EXISTS', 'Dữ liệu đã tồn tại'),
        );

      case 'P2025':
        return this.send(
          res,
          HttpStatus.NOT_FOUND,
          t('common.NOT_FOUND', 'Không tìm thấy dữ liệu'),
        );

      case 'P2003':
        return this.send(
          res,
          HttpStatus.BAD_REQUEST,
          t('common.INVALID_REFERENCE', 'Dữ liệu tham chiếu không hợp lệ'),
        );

      default:
        this.logger.error(
          `Lỗi Prisma chưa xử lý: ${exception.code} — ${exception.message}`,
        );
        return this.send(
          res,
          HttpStatus.INTERNAL_SERVER_ERROR,
          t('common.INTERNAL_ERROR', 'Có lỗi xảy ra, vui lòng thử lại'),
        );
    }
  }

  private send(res: Response, status: number, message: string) {
    res.status(status).json({ errors: { body: [message] } });
  }
}
