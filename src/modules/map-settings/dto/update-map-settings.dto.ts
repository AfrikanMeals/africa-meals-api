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
import { KNOWN_ROUTING_ENGINES } from '@common/routing-engine-pool.util';
import { KNOWN_TRAFFIC_ENGINES } from '@common/traffic-engine-pool.util';
import { GeocodingEnginePoolEntryDto } from './geocoding-engine-pool-entry.dto';
import { RoutingEnginePoolEntryDto } from './routing-engine-pool-entry.dto';
import { TrafficEnginePoolEntryDto } from './traffic-engine-pool-entry.dto';
import { RoutingCacheSettingsDto } from './routing-cache-settings.dto';

const VENDOR_ENGINES = ['mapbox', 'google', 'osm'] as const;
const MOBILE_ENGINES = ['mapbox', 'google', 'osm'] as const;
const GEOCODING_ENGINES = [...KNOWN_GEOCODING_ENGINES] as const;
const ROUTING_ENGINES = [...KNOWN_ROUTING_ENGINES] as const;
const TRAFFIC_PRIMARY = ['none', ...KNOWN_TRAFFIC_ENGINES] as const;
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

  @ApiPropertyOptional({ enum: ROUTING_ENGINES, default: 'osrm' })
  @IsOptional()
  @IsString()
  @IsIn(ROUTING_ENGINES)
  vendorRoutingEngine?: string;

  @ApiPropertyOptional({ enum: ROUTING_ENGINES, default: 'osrm' })
  @IsOptional()
  @IsString()
  @IsIn(ROUTING_ENGINES)
  mobileUserRoutingEngine?: string;

  @ApiPropertyOptional({ enum: ROUTING_ENGINES, default: 'osrm' })
  @IsOptional()
  @IsString()
  @IsIn(ROUTING_ENGINES)
  mobileDeliveryRoutingEngine?: string;

  @ApiPropertyOptional({ type: [RoutingEnginePoolEntryDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoutingEnginePoolEntryDto)
  vendorRoutingEnginePool?: RoutingEnginePoolEntryDto[];

  @ApiPropertyOptional({ type: [RoutingEnginePoolEntryDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoutingEnginePoolEntryDto)
  mobileUserRoutingEnginePool?: RoutingEnginePoolEntryDto[];

  @ApiPropertyOptional({ type: [RoutingEnginePoolEntryDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoutingEnginePoolEntryDto)
  mobileDeliveryRoutingEnginePool?: RoutingEnginePoolEntryDto[];

  @ApiPropertyOptional({
    enum: TRAFFIC_PRIMARY,
    default: 'none',
    description:
      'Moteur trafic : none | fleet (télémétrie livreurs) | tomtom | mapbox',
  })
  @IsOptional()
  @IsString()
  @IsIn(TRAFFIC_PRIMARY)
  trafficEngine?: string;

  @ApiPropertyOptional({ type: [TrafficEnginePoolEntryDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TrafficEnginePoolEntryDto)
  trafficEnginePool?: TrafficEnginePoolEntryDto[];

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

  @ApiPropertyOptional({ type: RoutingCacheSettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => RoutingCacheSettingsDto)
  routingCache?: RoutingCacheSettingsDto;
}
