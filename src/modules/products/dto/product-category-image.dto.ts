import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class ProductCategoryImageJsonDto {
  @ApiProperty({
    description: 'Image en base64 (pur ou préfixe data:image/...;base64,)',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(7_500_000)
  imageBase64: string;

  @ApiPropertyOptional({ example: 'category.jpg' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  filename?: string;
}
