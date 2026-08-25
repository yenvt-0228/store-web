import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
import { OrderStatus } from '../../generated/prisma/enums';

export class UpdateOrderStatusDto {
  @IsEnum(OrderStatus, { message: i18nValidationMessage('validation.IS_ENUM') })
  status: OrderStatus;

  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @MaxLength(500, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  reason?: string;
}
