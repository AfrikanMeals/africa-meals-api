import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Trim } from 'class-sanitizer';
import { IsNotEmpty, IsNumber, IsOptional } from 'class-validator';

export class CreateProductDto {
  @ApiProperty({ example: 'Poulet braisé' })
  @IsNotEmpty()
  @Trim()
  title: string;

  @ApiProperty({ example: 'Plat traditionnel' })
  @IsNotEmpty()
  @Trim()
  bio: string;

  @ApiProperty({ example: 'Sénégal' })
  @IsNotEmpty()
  @Trim()
  originCountry: string;

  @ApiProperty({ example: 12.99, type: Number })
  @IsNotEmpty()
  @IsNumber()
  price: string;

  @ApiPropertyOptional({ example: 'Description détaillée' })
  @IsOptional()
  @Trim()
  about?: string;

  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  @IsNotEmpty()
  @Trim()
  category: string;
}

export class CreateProductExtraDto {
  @ApiProperty({ example: 'Sauce supplémentaire' })
  @IsNotEmpty()
  @Trim()
  title: string;

  @ApiProperty({ example: 'Sauce piquante maison' })
  @IsNotEmpty()
  @Trim()
  description: string;

  @ApiProperty({ example: 1.5, type: Number })
  @IsNotEmpty()
  @IsNumber()
  price: number;

  @ApiPropertyOptional({ type: 'string', format: 'binary' })
  @IsOptional()
  @Trim()
  image?: Express.Multer.File;

  @IsOptional()
  profileImage?: string;
}
