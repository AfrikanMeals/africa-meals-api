import { Trim } from 'class-sanitizer';
import {
  IsBoolean,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
} from 'class-validator';

export class SearchAddressDto {
  @IsNotEmpty()
  @Trim()
  address: string;

  @IsNotEmpty()
  @Trim()
  country: string;

  @IsNotEmpty()
  @Trim()
  city: string;

  @IsNotEmpty()
  @Trim()
  zipCode: string;
}

export class CreateAddressDto extends SearchAddressDto {
  // @IsNotEmpty()
  // @IsEnum(AddressTypeEnum)
  // type: AddressTypeEnum;

  @IsNotEmpty()
  @IsLongitude()
  longitude: number;

  @IsNotEmpty()
  @IsLatitude()
  latitude: number;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
