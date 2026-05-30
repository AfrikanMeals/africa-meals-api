import { ApiProperty } from '@nestjs/swagger';
import { Trim } from 'class-sanitizer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsString,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AdminSupportedCountryItemDto {
  @ApiProperty({ example: 'CA' })
  @IsString()
  @Trim()
  @Length(2, 2)
  @Matches(/^[A-Z]{2}$/i)
  code: string;

  @ApiProperty({ example: 'Canada' })
  @IsString()
  @Trim()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'CA' })
  @IsString()
  @Trim()
  @Length(2, 2)
  @Matches(/^[A-Z]{2}$/i)
  phoneRegion: string;

  @ApiProperty({ example: 'CAD' })
  @IsString()
  @Trim()
  @Length(3, 3)
  @Matches(/^[A-Z]{3}$/i)
  currency: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  active: boolean;
}

export class AdminSupportedCountriesUpdateDto {
  @ApiProperty({ type: [AdminSupportedCountryItemDto] })
  @IsArray()
  @ArrayMaxSize(250)
  @ValidateNested({ each: true })
  @Type(() => AdminSupportedCountryItemDto)
  countries: AdminSupportedCountryItemDto[];
}
