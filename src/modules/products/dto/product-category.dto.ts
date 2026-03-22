import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Trim } from 'class-sanitizer';
import { IsBoolean, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateProductCategoryDto {
  @ApiProperty({ example: 'Plats traditionnels' })
  @IsNotEmpty()
  @Trim()
  title: string;

  @ApiProperty({ example: 'meals' })
  @IsNotEmpty()
  @Trim()
  icon: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}

export class PatchProductCategoryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsNotEmpty()
  @Trim()
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNotEmpty()
  @Trim()
  icon?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}
