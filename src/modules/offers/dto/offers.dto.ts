import { OfferItemTypeEnum, OfferStatusEnum } from '@schemas/offer.schema';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Trim } from 'class-sanitizer';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class OfferItemDto {
  @ApiProperty({
    enum: OfferItemTypeEnum,
    description: 'Type d’élément (produit, extra, etc.)',
  })
  @IsNotEmpty()
  @IsEnum(OfferItemTypeEnum)
  type: OfferItemTypeEnum;

  @ApiProperty({ minimum: 1, example: 1, type: Number })
  @IsNotEmpty()
  @IsNumber()
  quantity: number;

  @ApiProperty({ example: 9.99, type: Number })
  @IsNotEmpty()
  @IsNumber()
  price: number;

  @ApiProperty({
    description: 'ID de l’entité (produit/store)',
    example: '507f1f77bcf86cd799439011',
  })
  @IsNotEmpty()
  entityId: string;

  @ApiPropertyOptional({
    description: 'Requis si type = PRODUCT',
    example: '507f1f77bcf86cd799439012',
  })
  @IsNotEmpty()
  @ValidateIf((o) => o.type === OfferItemTypeEnum.PRODUCT)
  productId?: string;
}

export class CreateOfferDto {
  @ApiProperty({ example: 'Menu duo à 15€' })
  @IsNotEmpty()
  @Trim()
  title: string;

  @ApiPropertyOptional({ example: 'Deux plats au choix + boisson' })
  @IsOptional()
  @Trim()
  description: string;

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2025-03-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2025-03-31T23:59:59.000Z',
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiProperty({ example: 14.99, type: Number })
  @IsNotEmpty()
  @IsNumber()
  price: number;

  @ApiProperty({
    type: () => [OfferItemDto],
    description: 'Au moins 2 éléments dans l’offre',
    minItems: 2,
  })
  @IsNotEmpty()
  @IsArray()
  @ArrayMinSize(2)
  @Type(() => OfferItemDto)
  @ValidateNested({ each: true })
  items: OfferItemDto[];

  @ApiPropertyOptional({
    type: 'string',
    format: 'binary',
    description: 'Image de l’offre',
  })
  @IsOptional()
  image?: Express.Multer.File;

  @IsOptional()
  profileImage?: string;
}

export class FilterOffersDto {
  @ApiPropertyOptional({ example: '507f1f77bcf86cd799439011' })
  @IsOptional()
  storeId?: string;

  @ApiPropertyOptional({ enum: OfferStatusEnum })
  @IsOptional()
  @IsEnum(OfferStatusEnum)
  status?: OfferStatusEnum;

  @ApiPropertyOptional({ minimum: 1, type: Number })
  @IsOptional()
  @Transform(({ value }) => (value ? +value : undefined))
  take?: number;

  @ApiPropertyOptional({ minimum: 1, type: Number })
  @IsOptional()
  @Transform(({ value }) => (value ? +value : undefined))
  page?: number;
}
