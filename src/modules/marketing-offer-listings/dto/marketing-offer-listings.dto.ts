import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { MarketingOfferListingStatusEnum } from '@schemas/marketing-offer-listing.schema';

export class CreateMarketingOfferListingDto {
  @ApiProperty({ description: 'ID stratégie marketing (marketing_offers)' })
  @IsMongoId()
  marketingOfferId: string;

  @ApiProperty({ description: 'ID produit catalogue boutique' })
  @IsMongoId()
  productId: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 99 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(99)
  buyQuantity?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 99 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(99)
  getQuantity?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 99 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(99)
  rewardPercent?: number;

  @ApiPropertyOptional({ description: 'Seuil panier (stratégies SPEND_X)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  spendThreshold?: number;

  @ApiPropertyOptional({ description: 'Remise fixe au seuil (SPEND_X_GET_Y_OFF)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  rewardFixedAmount?: number;
}

export class PatchMarketingOfferListingDto {
  @ApiPropertyOptional({ enum: MarketingOfferListingStatusEnum })
  @IsOptional()
  @IsEnum(MarketingOfferListingStatusEnum)
  status?: MarketingOfferListingStatusEnum;

  @ApiPropertyOptional({ minimum: 1, maximum: 99 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(99)
  buyQuantity?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 99 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(99)
  getQuantity?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 99 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(99)
  rewardPercent?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  spendThreshold?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  rewardFixedAmount?: number;
}

export class MarketingOfferDealsFeedQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 5, default: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  take?: number;

  @ApiPropertyOptional({ description: 'Code région catalogue (ex. CM, CA)' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  regionCode?: string;
}

export class TrackMarketingOfferDealDto {
  @ApiProperty({ enum: ['click', 'checkout_start'] })
  @IsIn(['click', 'checkout_start'])
  event: 'click' | 'checkout_start';
}

export class DirectCheckoutMarketingOfferDealDto {
  @ApiPropertyOptional({
    description: 'Quantité choisie sur la fiche offre (1–999)',
    minimum: 1,
    maximum: 999,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(999)
  quantity?: number;
}
