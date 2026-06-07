import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProductCategoryKindEnum } from '@schemas/product-category.schema';
import { Trim } from 'class-sanitizer';
import { IsBoolean, IsEnum, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateProductCategoryDto {
  @ApiProperty({ example: 'Plats traditionnels' })
  @IsNotEmpty()
  @Trim()
  title: string;

  @ApiProperty({ example: 'meals' })
  @IsNotEmpty()
  @Trim()
  icon: string;

  @ApiPropertyOptional({ enum: ProductCategoryKindEnum, default: ProductCategoryKindEnum.FOOD })
  @IsOptional()
  @IsEnum(ProductCategoryKindEnum)
  kind?: ProductCategoryKindEnum;

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

  @ApiPropertyOptional({ enum: ProductCategoryKindEnum })
  @IsOptional()
  @IsEnum(ProductCategoryKindEnum)
  kind?: ProductCategoryKindEnum;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}
