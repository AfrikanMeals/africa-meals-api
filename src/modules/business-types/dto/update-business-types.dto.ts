import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class BusinessTypeItemDto {
  @ApiProperty({ example: 'RESTAURANT' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Matches(/^[A-Z][A-Z0-9_]*$/, {
    message: 'slug must be UPPER_SNAKE_CASE',
  })
  slug: string;

  @ApiProperty({ example: 'Restaurant' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  labelFr: string;

  @ApiProperty({ example: 'Restaurant' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  labelEn: string;

  @ApiProperty({ example: 0 })
  @IsInt()
  @Min(0)
  sortOrder: number;

  @ApiProperty({ example: true })
  @IsBoolean()
  isActive: boolean;
}

export class UpdateBusinessTypesDto {
  @ApiProperty({ type: [BusinessTypeItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BusinessTypeItemDto)
  types: BusinessTypeItemDto[];
}
