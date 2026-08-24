import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsUrl,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';

export class ProductImageInputDto {
  @IsUrl(
    { require_tld: false },
    { message: i18nValidationMessage('validation.IS_URL') },
  )
  @MaxLength(500, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  imageUrl: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: i18nValidationMessage('validation.IS_INT') })
  @Min(0, { message: i18nValidationMessage('validation.MIN') })
  sortOrder?: number;

  @IsOptional()
  @IsBoolean({ message: i18nValidationMessage('validation.IS_BOOLEAN') })
  isPrimary?: boolean;
}

export class UpdateProductImageDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: i18nValidationMessage('validation.IS_INT') })
  @Min(0, { message: i18nValidationMessage('validation.MIN') })
  sortOrder?: number;

  @IsOptional()
  @IsBoolean({ message: i18nValidationMessage('validation.IS_BOOLEAN') })
  isPrimary?: boolean;
}

export class AddProductImagesDto {
  @IsArray({ message: i18nValidationMessage('validation.IS_ARRAY') })
  @ArrayNotEmpty({ message: i18nValidationMessage('validation.IS_NOT_EMPTY') })
  @ArrayMaxSize(10, { message: i18nValidationMessage('validation.MAX') })
  @ValidateNested({ each: true })
  @Type(() => ProductImageInputDto)
  images: ProductImageInputDto[];
}

export class ProductImageResponseDto {
  id: string;
  imageUrl: string;
  sortOrder: number;
  isPrimary: boolean;
}
