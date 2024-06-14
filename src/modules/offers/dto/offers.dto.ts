import { OfferItemTypeEnum, OfferStatusEnum } from '@schemas/offer.schema';
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

class OfferItemDto {
  @IsNotEmpty()
  @IsEnum(OfferItemTypeEnum)
  type: OfferItemTypeEnum;

  @IsNotEmpty()
  @IsNumber()
  quantity: number;

  @IsNotEmpty()
  @IsNumber()
  price: number;

  @IsNotEmpty()
  entityId: string;

  @IsNotEmpty()
  @ValidateIf((o) => o.type === OfferItemTypeEnum.PRODUCT)
  productId?: string;
}

export class CreateOfferDto {
  @IsNotEmpty()
  @Trim()
  title: string;

  @IsOptional()
  @Trim()
  description: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsNotEmpty()
  @IsNumber()
  price: number;

  @IsNotEmpty()
  @IsArray()
  @ArrayMinSize(2)
  @Type(() => Array<OfferItemDto>)
  @ValidateNested({ each: true })
  items: OfferItemDto[];

  @IsOptional()
  image?: Express.Multer.File;

  @IsOptional()
  profileImage?: string;
}

export class FilterOffersDto {
  @IsOptional()
  storeId?: string;

  @IsOptional()
  @IsEnum(OfferStatusEnum)
  status?: OfferStatusEnum;

  @IsOptional()
  @Transform(({ value }) => (value ? +value : undefined))
  take?: number;

  @IsOptional()
  @Transform(({ value }) => (value ? +value : undefined))
  page?: number;
}
