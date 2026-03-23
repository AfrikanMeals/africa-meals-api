import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProductStatusEnum } from '@schemas/product.schema';
import { Trim } from 'class-sanitizer';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  Min,
} from 'class-validator';

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
  @Min(0)
  price: number;

  @ApiPropertyOptional({ example: 0, type: Number })
  @IsOptional()
  @IsNumber()
  @Min(0)
  discountPrice?: number;

  @ApiPropertyOptional({ example: 'CAD' })
  @IsOptional()
  @Trim()
  currency?: string;

  @ApiPropertyOptional({ enum: ProductStatusEnum })
  @IsOptional()
  @IsEnum(ProductStatusEnum)
  status?: ProductStatusEnum;

  @ApiPropertyOptional({ example: 'Description détaillée' })
  @IsOptional()
  @Trim()
  about?: string;

  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  @IsNotEmpty()
  @Trim()
  category: string;
}

export class PatchProductDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsNotEmpty()
  @Trim()
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNotEmpty()
  @Trim()
  bio?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  about?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNotEmpty()
  @Trim()
  originCountry?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  discountPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  currency?: string;

  @ApiPropertyOptional({ enum: ProductStatusEnum })
  @IsOptional()
  @IsEnum(ProductStatusEnum)
  status?: ProductStatusEnum;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNotEmpty()
  @Trim()
  category?: string;

  @ApiPropertyOptional({
    description: 'Si true, supprime les images de galerie (sans en envoyer de nouvelles).',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  clearGallery?: boolean;
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
