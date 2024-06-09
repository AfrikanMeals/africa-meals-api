import { CreateAddressDto } from '@modules/addresses/dto/addresses.dto';
import { Type } from 'class-transformer';
import { IsNotEmpty, IsPhoneNumber, ValidateNested } from 'class-validator';

export class CreateStoreDto {
  @IsNotEmpty()
  name: string;

  @IsNotEmpty()
  bio: string;

  @IsNotEmpty()
  email: string;

  @IsNotEmpty()
  @IsPhoneNumber('CA')
  phoneNumber: string;

  @IsNotEmpty()
  @ValidateNested()
  @Type(() => CreateAddressDto)
  address: CreateAddressDto;
}
