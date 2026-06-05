import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Trim } from 'class-sanitizer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  REGION_TAX_FEE_TYPES,
  REGION_TAX_MODULES,
} from '../region-tax.constants';

export class RegionTaxRuleDto {
  @ApiProperty({ example: 'TPS' })
  @IsString()
  @Trim()
  @IsNotEmpty()
  @Length(1, 120)
  name: string;

  @ApiPropertyOptional({ example: 'Taxe sur les produits et services' })
  @IsOptional()
  @IsString()
  @Trim()
  @Length(0, 500)
  description?: string;

  @ApiProperty({ enum: REGION_TAX_FEE_TYPES, example: 'percent' })
  @IsIn([...REGION_TAX_FEE_TYPES])
  feeType: 'percent' | 'fixed';

  @ApiProperty({ example: 5 })
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  feeValue: number;

  @ApiProperty({
    type: [String],
    example: ['order'],
    description: 'order | payout | subscription | refund',
  })
  @IsArray()
  @ArrayMaxSize(8)
  @IsIn([...REGION_TAX_MODULES], { each: true })
  modules: string[];
}

export class AdminRegionTaxesUpdateDto {
  @ApiProperty({ type: [RegionTaxRuleDto] })
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => RegionTaxRuleDto)
  taxes: RegionTaxRuleDto[];
}

export class RegionTaxEstimateQueryDto {
  @ApiProperty({ example: 'CA' })
  @IsString()
  @Trim()
  @Length(2, 2)
  @Matches(/^[A-Z]{2}$/i)
  countryCode: string;

  @ApiProperty({ example: 100 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount: number;

  @ApiProperty({ enum: REGION_TAX_MODULES, example: 'order' })
  @IsIn([...REGION_TAX_MODULES])
  module: string;
}
