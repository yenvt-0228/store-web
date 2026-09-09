import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, Matches } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
import { OrderStatus } from '../../generated/prisma/enums';

// `@IsISO8601()` is too permissive for a date the code then hands to `new
// Date()`: it also accepts the basic form (20261231) and week dates (2026-W01),
// which both parse to Invalid Date. Accept the two forms the report actually
// supports — a calendar day, optionally followed by a time.
const ISO_DATE_OR_DATETIME =
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

export class OrderReportDto {
  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @Matches(ISO_DATE_OR_DATETIME, {
    message: i18nValidationMessage('validation.IS_DATE'),
  })
  from?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @Matches(ISO_DATE_OR_DATETIME, {
    message: i18nValidationMessage('validation.IS_DATE'),
  })
  to?: string;

  @ApiPropertyOptional({ enum: OrderStatus })
  @IsOptional()
  @IsEnum(OrderStatus, { message: i18nValidationMessage('validation.IS_ENUM') })
  status?: OrderStatus;
}
