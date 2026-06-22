import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Trim } from 'class-sanitizer';
import {
  IsBoolean,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class SearchAddressDto {
  @ApiProperty({ example: '123 rue Example' })
  @IsNotEmpty()
  @Trim()
  address: string;

  @ApiProperty({ example: 'Canada' })
  @IsNotEmpty()
  @Trim()
  country: string;

  @ApiProperty({ example: 'Montréal' })
  @IsNotEmpty()
  @Trim()
  city: string;

  @ApiProperty({ example: 'H2X 1Y4' })
  @IsNotEmpty()
  @Trim()
  zipCode: string;

  @ApiPropertyOptional({
    example: 'CA',
    description: 'Code pays ISO — filtre géocodage (optionnel)',
  })
  @IsOptional()
  @IsString()
  @Trim()
  countryCode?: string;
}

export class CreateAddressDto extends SearchAddressDto {
  @ApiProperty({ example: 'CA', description: 'Code pays ISO' })
  @IsNotEmpty()
  @Trim()
  countryCode: string;

  @ApiProperty({ example: -73.5698, type: Number, description: 'Longitude' })
  @IsNotEmpty()
  @IsLongitude()
  longitude: number;

  @ApiProperty({ example: 45.5017, type: Number, description: 'Latitude' })
  @IsNotEmpty()
  @IsLatitude()
  latitude: number;

  @ApiPropertyOptional({ type: Boolean, default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({
    example: 'Domicile',
    description: 'Type de lieu : Domicile, Bureau, Travail, Autre, etc.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Trim()
  label?: string;
}
