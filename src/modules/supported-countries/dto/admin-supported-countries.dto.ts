import { ApiProperty } from '@nestjs/swagger';
import { Trim } from 'class-sanitizer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AdminSupportedCountryItemDto {
  @ApiProperty({ example: 'CA' })
  @IsString()
  @Trim()
  @Length(2, 2)
  @Matches(/^[A-Z]{2}$/i)
  code: string;

  @ApiProperty({ example: 'Canada' })
  @IsString()
  @Trim()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'CA' })
  @IsString()
  @Trim()
  @Length(2, 2)
  @Matches(/^[A-Z]{2}$/i)
  phoneRegion: string;

  @ApiProperty({ example: 'CAD' })
  @IsString()
  @Trim()
  @Length(3, 3)
  @Matches(/^[A-Z]{3}$/i)
  currency: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  active: boolean;

  @ApiProperty({
    example: 'America/Toronto',
    required: false,
    description: 'Fuseau IANA pour menu du jour et horaires régionaux.',
  })
  @IsOptional()
  @IsString()
  @Trim()
  timezone?: string;

  @ApiProperty({
    example: true,
    required: false,
    description:
      'Stripe : montants entiers (×1) au lieu de centimes (×100). Par défaut dérivé de la devise.',
  })
  @IsOptional()
  @IsBoolean()
  stripeZeroDecimal?: boolean;

  @ApiProperty({
    example: 1,
    required: false,
    description: '1 Ad Cash = X unités de la devise régionale.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0.0001)
  adCashToCurrencyRate?: number;
}

export class AdminSupportedCountriesUpdateDto {
  @ApiProperty({ type: [AdminSupportedCountryItemDto] })
  @IsArray()
  @ArrayMaxSize(250)
  @ValidateNested({ each: true })
  @Type(() => AdminSupportedCountryItemDto)
  countries: AdminSupportedCountryItemDto[];
}
