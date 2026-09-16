import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';

// Chặn ở hai đầu vì con số này đi thẳng vào mệnh đề WHERE của một truy vấn gộp:
// year = 0 hay year = 999999 không sai về kiểu nhưng quét vô nghĩa.
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

export class RevenueMonthlyDto {
  @ApiPropertyOptional({ example: 2026 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: i18nValidationMessage('validation.IS_INT') })
  @Min(MIN_YEAR, { message: i18nValidationMessage('validation.MIN') })
  @Max(MAX_YEAR, { message: i18nValidationMessage('validation.MAX') })
  year?: number;
}

export class RevenueYearlyDto {
  @ApiPropertyOptional({ example: 2024 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: i18nValidationMessage('validation.IS_INT') })
  @Min(MIN_YEAR, { message: i18nValidationMessage('validation.MIN') })
  @Max(MAX_YEAR, { message: i18nValidationMessage('validation.MAX') })
  fromYear?: number;

  @ApiPropertyOptional({ example: 2026 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: i18nValidationMessage('validation.IS_INT') })
  @Min(MIN_YEAR, { message: i18nValidationMessage('validation.MIN') })
  @Max(MAX_YEAR, { message: i18nValidationMessage('validation.MAX') })
  toYear?: number;
}
