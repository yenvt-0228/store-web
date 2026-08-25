import { Type } from 'class-transformer';
import { IsInt, IsUUID, Max, Min } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
import { MAX_QUANTITY_PER_ITEM } from '../cart.constant';

export class AddCartItemDto {
  @IsUUID(undefined, { message: i18nValidationMessage('validation.IS_UUID') })
  productId: string;

  @Type(() => Number)
  @IsInt({ message: i18nValidationMessage('validation.IS_INT') })
  @Min(1, { message: i18nValidationMessage('validation.MIN') })
  @Max(MAX_QUANTITY_PER_ITEM, {
    message: i18nValidationMessage('validation.MAX'),
  })
  quantity: number;
}
