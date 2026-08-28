import { IsEnum, IsUUID } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
import { PaymentMethod } from '../../generated/prisma/enums';

export class CreatePaymentDto {
  @IsUUID(undefined, { message: i18nValidationMessage('validation.IS_UUID') })
  orderId: string;

  @IsEnum(PaymentMethod, {
    message: i18nValidationMessage('validation.IS_ENUM'),
  })
  paymentMethod: PaymentMethod;
}
