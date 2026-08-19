import {
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
} from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';

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
}
