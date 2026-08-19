import { IsEnum } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
import { UserStatus } from '../../../generated/prisma/enums';

export class UpdateUserStatusDto {
  @IsEnum(UserStatus, { message: i18nValidationMessage('validation.IS_ENUM') })
  status: UserStatus;
}
