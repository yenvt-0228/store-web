import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class SendMessageDto {
  @IsOptional()
  @IsUUID(undefined, { message: i18nValidationMessage('validation.IS_UUID') })
  // Khách bỏ trống thì gửi vào hội thoại của chính mình — họ chỉ có một. Admin
  // thì bắt buộc phải nói rõ đang trả lời ai.
  conversationId?: string;

  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: i18nValidationMessage('validation.IS_NOT_EMPTY') })
  @MaxLength(4000, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  content: string;
}

export class ListMessageDto extends PaginationDto {
  @IsOptional()
  @IsUUID(undefined, { message: i18nValidationMessage('validation.IS_UUID') })
  conversationId?: string;
}
