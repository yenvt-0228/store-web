import { IsEnum, IsOptional, IsString } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { UserStatus } from '../../../generated/prisma/enums';

export class ListUserDto extends PaginationDto {
  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  keyword?: string;

  @IsOptional()
  @IsEnum(UserStatus, {
    message: i18nValidationMessage('validation.IS_ENUM'),
  })
  status?: UserStatus;
}
