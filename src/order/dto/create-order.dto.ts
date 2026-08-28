import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
import { PaymentMethod } from '../../generated/prisma/enums';

export class OrderItemInputDto {
  @IsUUID(undefined, { message: i18nValidationMessage('validation.IS_UUID') })
  productId: string;

  @Type(() => Number)
  @IsInt({ message: i18nValidationMessage('validation.IS_INT') })
  @Min(1, { message: i18nValidationMessage('validation.MIN') })
  quantity: number;
}

export class CreateOrderDto {
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: i18nValidationMessage('validation.IS_NOT_EMPTY') })
  @MaxLength(255, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  shippingName: string;

  @Matches(/^(\+84|0)\d{8,10}$/, {
    message: i18nValidationMessage('validation.IS_PHONE'),
  })
  shippingPhone: string;

  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: i18nValidationMessage('validation.IS_NOT_EMPTY') })
  shippingAddress: string;

  @IsEnum(PaymentMethod, {
    message: i18nValidationMessage('validation.IS_ENUM'),
  })
  paymentMethod: PaymentMethod;

  @IsOptional()
  @IsArray({ message: i18nValidationMessage('validation.IS_ARRAY') })
  @ArrayMaxSize(50, { message: i18nValidationMessage('validation.MAX') })
  @ValidateNested({ each: true })
  @Type(() => OrderItemInputDto)
  items?: OrderItemInputDto[];
}
