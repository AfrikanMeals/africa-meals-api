import { CreateAddressDto } from '@modules/addresses/dto/addresses.dto';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsPhoneNumber,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

class StoreShippingZoneDto {
  @IsNotEmpty()
  @IsNumber()
  @Transform(({ value }) => +value)
  minDistance: number;

  @IsNotEmpty()
  @IsNumber()
  @Transform(({ value }) => +value)
  maxDistance: number;

  @IsNotEmpty()
  @IsNumber()
  @Transform(({ value }) => +value)
  price: number;
}

export class CreateStoreDto {
  @IsNotEmpty()
  name: string;

  @IsNotEmpty()
  bio: string;

  @IsNotEmpty()
  email: string;

  @IsNotEmpty()
  @IsBoolean()
  supportsShipping: boolean;

  @IsNotEmpty()
  @IsPhoneNumber('CA')
  phoneNumber: string;

  @IsNotEmpty()
  @ValidateNested()
  @Type(() => CreateAddressDto)
  address: CreateAddressDto;

  @IsNotEmpty()
  @ValidateNested()
  @ArrayMinSize(1)
  @Type(() => StoreShippingZoneDto)
  @ValidateIf((o) => o.shippingZones?.length > 0 || o.supportsShipping)
  shippingZones?: StoreShippingZoneDto;
}
