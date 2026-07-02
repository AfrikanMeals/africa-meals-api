import { MarketingOfferModerationStatusEnum } from '@schemas/marketing-offer.schema';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class PatchMarketingOfferModerationDto {
  @IsEnum(MarketingOfferModerationStatusEnum)
  moderationStatus!: MarketingOfferModerationStatusEnum;
}

export class CreateMarketingOfferItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  titleFr!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  titleEn!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  descriptionFr?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  descriptionEn?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class PatchMarketingOfferItemDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  titleFr?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  titleEn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  descriptionFr?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  descriptionEn?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
