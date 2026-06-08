import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VendorFeatureRequestCategoryEnum } from '@schemas/vendor-feature-request.schema';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateVendorFeatureRequestDto {
  @ApiProperty({ example: 'Export CSV des commandes', maxLength: 120 })
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  title: string;

  @ApiProperty({
    example: 'Nous aimerions exporter les commandes par période au format CSV.',
    maxLength: 4000,
  })
  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  description: string;

  @ApiPropertyOptional({ enum: VendorFeatureRequestCategoryEnum })
  @IsOptional()
  @IsEnum(VendorFeatureRequestCategoryEnum)
  category?: VendorFeatureRequestCategoryEnum;

  @ApiPropertyOptional({ description: 'Boutique active du vendeur (optionnel)' })
  @IsOptional()
  @IsString()
  storeId?: string;
}
