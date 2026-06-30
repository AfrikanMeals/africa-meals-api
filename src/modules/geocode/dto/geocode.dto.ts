import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { GEOCODE_MIN_QUERY_LENGTH } from '@common/normalize-geocode-query.util';

const GEOCODE_CONTEXTS = ['vendor', 'mobileUser', 'mobileDelivery'] as const;

export class ForwardGeocodeQueryDto {
  @ApiPropertyOptional({ example: '123 rue Sainte-Catherine' })
  @IsString()
  q: string;

  @ApiPropertyOptional({ example: 'CA' })
  @IsOptional()
  @IsString()
  countryCode?: string;

  @ApiPropertyOptional({ default: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(10)
  limit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  proximityLng?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  proximityLat?: number;

  @ApiPropertyOptional({ enum: GEOCODE_CONTEXTS, default: 'mobileUser' })
  @IsOptional()
  @IsIn(GEOCODE_CONTEXTS)
  context?: (typeof GEOCODE_CONTEXTS)[number];
}

export class ReverseGeocodeQueryDto {
  @ApiPropertyOptional()
  @Type(() => Number)
  @IsNumber()
  lat: number;

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsNumber()
  lng: number;

  @ApiPropertyOptional({ example: 'CA' })
  @IsOptional()
  @IsString()
  countryCode?: string;

  @ApiPropertyOptional({ enum: GEOCODE_CONTEXTS, default: 'mobileUser' })
  @IsOptional()
  @IsIn(GEOCODE_CONTEXTS)
  context?: (typeof GEOCODE_CONTEXTS)[number];
}

export function isGeocodeQueryLongEnough(raw?: string | null): boolean {
  return String(raw ?? '').trim().length >= GEOCODE_MIN_QUERY_LENGTH;
}
