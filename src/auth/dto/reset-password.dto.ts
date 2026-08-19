import { IsNotEmpty, IsString, MinLength } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
import { Match } from '../../common/validators/match.validator';

export class ResetPasswordDto {
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: i18nValidationMessage('validation.IS_NOT_EMPTY') })
  token: string;

  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @MinLength(6, { message: i18nValidationMessage('validation.MIN_LENGTH') })
  password: string;

  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @Match('password', { message: i18nValidationMessage('validation.MATCH') })
  confirmPassword: string;
}
