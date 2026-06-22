import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

const VENDOR_ENGINES = ['mapbox', 'google', 'osm'] as const;
const MOBILE_ENGINES = ['mapbox', 'google', 'osm'] as const;

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
}
