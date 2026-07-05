import {
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateDashboardOrderDeliveryAddressDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  address: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  zipCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  countryCode?: string;

  @IsLatitude()
  latitude: number;

  @IsLongitude()
  longitude: number;
}
