import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
import { NormalizeEmail } from '../../common/decorators/normalize-email.decorator';
import { Match } from '../../common/validators/match.validator';

export class RegisterDto {
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: i18nValidationMessage('validation.IS_NOT_EMPTY') })
  @MaxLength(255, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  name: string;

  @NormalizeEmail()
  @IsEmail({}, { message: i18nValidationMessage('validation.IS_EMAIL') })
  @MaxLength(255, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  email: string;

  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @MinLength(6, { message: i18nValidationMessage('validation.MIN_LENGTH') })
  password: string;

  // Match('password'): phải trùng field password ở trên.
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @Match('password', { message: i18nValidationMessage('validation.MATCH') })
  confirmPassword: string;
}
