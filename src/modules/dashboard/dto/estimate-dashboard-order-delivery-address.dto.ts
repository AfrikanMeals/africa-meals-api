import { IsLatitude, IsLongitude, IsOptional, IsString, MaxLength } from 'class-validator';

export class EstimateDashboardOrderDeliveryAddressDto {
  @IsLatitude()
  latitude: number;

  @IsLongitude()
  longitude: number;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  countryCode?: string;
}
