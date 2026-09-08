import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsISO8601, IsOptional } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
import { OrderStatus } from '../../generated/prisma/enums';

export class OrderReportDto {
  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @IsISO8601({}, { message: i18nValidationMessage('validation.IS_DATE') })
  from?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsISO8601({}, { message: i18nValidationMessage('validation.IS_DATE') })
  to?: string;

  @ApiPropertyOptional({ enum: OrderStatus })
  @IsOptional()
  @IsEnum(OrderStatus, { message: i18nValidationMessage('validation.IS_ENUM') })
  status?: OrderStatus;
}
