import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProductCategoryKindEnum } from '@schemas/product-category.schema';
import { Trim } from 'class-sanitizer';
import { IsBoolean, IsEnum, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateProductCategoryDto {
  @ApiProperty({ example: 'Plats traditionnels' })
  @IsNotEmpty()
  @Trim()
  title: string;

  @ApiPropertyOptional({
    example: 'meals',
    description: 'Legacy — dérivé automatiquement du type si absent.',
  })
  @IsOptional()
  @Trim()
  icon?: string;

  @ApiPropertyOptional({ enum: ProductCategoryKindEnum, default: ProductCategoryKindEnum.FOOD })
  @IsOptional()
  @IsEnum(ProductCategoryKindEnum)
  kind?: ProductCategoryKindEnum;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'URL illustration (upload via POST /product-categories/image-json)',
  })
  @IsOptional()
  @Trim()
  image?: string;
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

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  image?: string;
}
