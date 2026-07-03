import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { KNOWN_GEOCODING_ENGINES } from '@common/geocoding-engine-pool.util';
import { GeocodingEnginePoolEntryDto } from './geocoding-engine-pool-entry.dto';

const VENDOR_ENGINES = ['mapbox', 'google', 'osm'] as const;
const MOBILE_ENGINES = ['mapbox', 'google', 'osm'] as const;
const GEOCODING_ENGINES = [...KNOWN_GEOCODING_ENGINES] as const;
const GEOCODE_CACHE_STORES = ['redis', 'memcached', 'mongodb'] as const;

export class UpdateMapSettingsDto {
  @ApiProperty()
  @IsBoolean()
  vendorMapboxEnabled: boolean;

  @ApiProperty()
  @IsBoolean()
  vendorGoogleEnabled: boolean;

  @ApiProperty()
  @IsBoolean()
  vendorOsmEnabled: boolean;

  @ApiPropertyOptional({ enum: VENDOR_ENGINES })
  @IsOptional()
  @IsString()
  @IsIn(VENDOR_ENGINES)
  vendorDefaultMapEngine?: string;

  @ApiProperty()
  @IsBoolean()
  mobileUserMapboxEnabled: boolean;

  @ApiProperty()
  @IsBoolean()
  mobileUserGoogleEnabled: boolean;

  @ApiProperty()
  @IsBoolean()
  mobileUserOsmEnabled: boolean;

  @ApiPropertyOptional({ enum: MOBILE_ENGINES })
  @IsOptional()
  @IsString()
  @IsIn(MOBILE_ENGINES)
  mobileUserDefaultMapEngine?: string;

  @ApiProperty()
  @IsBoolean()
  mobileDeliveryMapboxEnabled: boolean;

  @ApiProperty()
  @IsBoolean()
  mobileDeliveryGoogleEnabled: boolean;

  @ApiProperty()
  @IsBoolean()
  mobileDeliveryOsmEnabled: boolean;

  @ApiPropertyOptional({ enum: MOBILE_ENGINES })
  @IsOptional()
  @IsString()
  @IsIn(MOBILE_ENGINES)
  mobileDeliveryDefaultMapEngine?: string;

  @ApiPropertyOptional({ enum: GEOCODING_ENGINES, default: 'osm' })
  @IsOptional()
  @IsString()
  @IsIn(GEOCODING_ENGINES)
  vendorGeocodingEngine?: string;

  @ApiPropertyOptional({ enum: GEOCODING_ENGINES, default: 'osm' })
  @IsOptional()
  @IsString()
  @IsIn(GEOCODING_ENGINES)
  mobileUserGeocodingEngine?: string;

  @ApiPropertyOptional({ enum: GEOCODING_ENGINES, default: 'osm' })
  @IsOptional()
  @IsString()
  @IsIn(GEOCODING_ENGINES)
  mobileDeliveryGeocodingEngine?: string;

  @ApiPropertyOptional({ type: [GeocodingEnginePoolEntryDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GeocodingEnginePoolEntryDto)
  vendorGeocodingEnginePool?: GeocodingEnginePoolEntryDto[];

  @ApiPropertyOptional({ type: [GeocodingEnginePoolEntryDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GeocodingEnginePoolEntryDto)
  mobileUserGeocodingEnginePool?: GeocodingEnginePoolEntryDto[];

  @ApiPropertyOptional({ type: [GeocodingEnginePoolEntryDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GeocodingEnginePoolEntryDto)
  mobileDeliveryGeocodingEnginePool?: GeocodingEnginePoolEntryDto[];

  @ApiPropertyOptional({
    type: [String],
    enum: GEOCODE_CACHE_STORES,
    description:
      'Ordre de priorité des backends cache géocodage (redis, memcached, mongodb).',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsIn(GEOCODE_CACHE_STORES, { each: true })
  geocodeCacheStorePriority?: string[];
}
