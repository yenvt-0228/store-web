import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
import { IsIsoDate } from '../../common/validators/is-iso-date.validator';

// Giống OrderReportDto: `@IsISO8601()` quá dễ dãi với một chuỗi rồi sẽ được đưa
// cho `new Date()` — nó nhận cả 20261231 lẫn 2026-W01, hai thứ đều ra Invalid
// Date. Chỉ nhận đúng hai dạng thống kê thực sự hỗ trợ.
const ISO_DATE_OR_DATETIME =
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

export class StatisticsRangeDto {
  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @Matches(ISO_DATE_OR_DATETIME, {
    message: i18nValidationMessage('validation.IS_DATE'),
  })
  // Regex chỉ kiểm hình dạng. 2026-02-31 khớp regex, còn `Date` thì lăn nó sang
  // 3 tháng Ba chứ không từ chối — thống kê sẽ lặng lẽ tính dư ba ngày.
  @IsIsoDate({ message: i18nValidationMessage('validation.IS_DATE') })
  from?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @Matches(ISO_DATE_OR_DATETIME, {
    message: i18nValidationMessage('validation.IS_DATE'),
  })
  @IsIsoDate({ message: i18nValidationMessage('validation.IS_DATE') })
  to?: string;
}

export class TopProductsDto extends StatisticsRangeDto {
  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: i18nValidationMessage('validation.IS_INT') })
  @Min(1, { message: i18nValidationMessage('validation.MIN') })
  @Max(100, { message: i18nValidationMessage('validation.MAX') })
  limit?: number = 10;
}
