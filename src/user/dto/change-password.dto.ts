import { IsNotEmpty, IsString, MinLength } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
import { Match } from '../../common/validators/match.validator';

export class ChangePasswordDto {
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: i18nValidationMessage('validation.IS_NOT_EMPTY') })
  oldPassword: string;

  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @MinLength(6, { message: i18nValidationMessage('validation.MIN_LENGTH') })
  newPassword: string;

  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @Match('newPassword', { message: i18nValidationMessage('validation.MATCH') })
  confirmPassword: string;
}
