import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class UpsertBlogGroupDto {
  @ApiProperty({ example: 'actualites' })
  @IsString()
  @MaxLength(64)
  slug: string;

  @ApiPropertyOptional({ example: 'fr' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  locale?: string;

  @ApiProperty({ example: 'Actualités' })
  @IsString()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}
