import { IsEnum, IsOptional, IsString } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { OrderStatus } from '../../generated/prisma/enums';

export class ListOrderDto extends PaginationDto {
  @IsOptional()
  @IsEnum(OrderStatus, { message: i18nValidationMessage('validation.IS_ENUM') })
  status?: OrderStatus;

  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  keyword?: string;
}
