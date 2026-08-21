import {
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
} from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
import type { Locale } from '../../common/constants/locale.constant';
import { SUPPORTED_LOCALES } from '../../common/constants/locale.constant';

export class UpdateProfileDto {
  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @MaxLength(255, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  name?: string;

  @IsOptional()
  @Matches(/^(\+84|0)\d{8,10}$/, {
    message: i18nValidationMessage('validation.IS_PHONE'),
  })
  phone?: string;

  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @MaxLength(255, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  address?: string;

  @IsOptional()
  @IsUrl({}, { message: i18nValidationMessage('validation.IS_URL') })
  @MaxLength(500, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  avatar?: string;

  @IsOptional()
  @IsIn(SUPPORTED_LOCALES, {
    message: i18nValidationMessage('validation.IS_ENUM'),
  })
  locale?: Locale;
}
