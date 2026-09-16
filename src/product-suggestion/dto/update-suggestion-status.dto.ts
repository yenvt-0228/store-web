import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
import { SuggestionStatus } from '../../generated/prisma/enums';

export class UpdateSuggestionStatusDto {
  @IsEnum(SuggestionStatus, {
    message: i18nValidationMessage('validation.IS_ENUM'),
  })
  status: SuggestionStatus;

  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @MaxLength(500, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  note?: string;
}
