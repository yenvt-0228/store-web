import { IsEnum, IsOptional } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { SuggestionStatus } from '../../generated/prisma/enums';

export class ListSuggestionDto extends PaginationDto {
  @IsOptional()
  @IsEnum(SuggestionStatus, {
    message: i18nValidationMessage('validation.IS_ENUM'),
  })
  status?: SuggestionStatus;
}
