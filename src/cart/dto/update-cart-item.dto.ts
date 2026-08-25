import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
import { MAX_QUANTITY_PER_ITEM } from '../cart.constant';

export class UpdateCartItemDto {
  @Type(() => Number)
  @IsInt({ message: i18nValidationMessage('validation.IS_INT') })
  @Min(1, { message: i18nValidationMessage('validation.MIN') })
  @Max(MAX_QUANTITY_PER_ITEM, {
    message: i18nValidationMessage('validation.MAX'),
  })
  quantity: number;
}
