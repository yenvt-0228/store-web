import { IsEmail } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
import { NormalizeEmail } from '../../common/decorators/normalize-email.decorator';

export class ForgotPasswordDto {
  @NormalizeEmail()
  @IsEmail({}, { message: i18nValidationMessage('validation.IS_EMAIL') })
  email: string;
}
