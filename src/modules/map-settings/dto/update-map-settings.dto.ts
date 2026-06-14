import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateMapSettingsDto {
  @ApiProperty()
  @IsBoolean()
  vendorMapboxEnabled: boolean;

  @ApiProperty()
  @IsBoolean()
  vendorGoogleEnabled: boolean;

  @ApiProperty()
  @IsBoolean()
  mobileUserMapboxEnabled: boolean;

  @ApiProperty()
  @IsBoolean()
  mobileUserGoogleEnabled: boolean;

  @ApiProperty()
  @IsBoolean()
  mobileDeliveryMapboxEnabled: boolean;

  @ApiProperty()
  @IsBoolean()
  mobileDeliveryGoogleEnabled: boolean;
}
