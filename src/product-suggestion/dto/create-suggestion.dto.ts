import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';

export class CreateSuggestionDto {
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: i18nValidationMessage('validation.IS_NOT_EMPTY') })
  @MaxLength(255, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  name: string;

  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @MaxLength(2000, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  description?: string;

  @IsOptional()
  // Chỉ http/https: cột này rồi sẽ được render thành thẻ <a> trong trang admin,
  // và javascript: là một URL hợp lệ với bộ kiểm tra dễ dãi.
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true },
    { message: i18nValidationMessage('validation.IS_URL') },
  )
  @MaxLength(500, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  referenceUrl?: string;
}
