import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { EmbeddingProviderEnum } from '@schemas/search-settings.schema';

export class UpdateSearchSettingsDto {
  @IsBoolean()
  regexSearchEnabled: boolean;

  @IsBoolean()
  vectorSearchEnabled: boolean;

  @IsString()
  @MaxLength(120)
  vectorIndexName: string;

  @IsString()
  @MaxLength(120)
  embeddingModel: string;

  @IsEnum(EmbeddingProviderEnum)
  embeddingProvider: EmbeddingProviderEnum;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  embeddingBaseUrl?: string;

  /** Si fourni et non vide, remplace la clé en base. Chaîne vide = revenir aux variables d’env. */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  embeddingApiKey?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8)
  minQueryLength: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  defaultMaxDistanceKm: number;

  @IsBoolean()
  searchProductsEnabled: boolean;

  @IsBoolean()
  searchStoresEnabled: boolean;

  @IsBoolean()
  searchDrinksEnabled: boolean;

  @IsBoolean()
  searchOffersEnabled: boolean;

  @IsBoolean()
  reindexCronEnabled: boolean;

  @IsString()
  @MaxLength(64)
  reindexCronExpression: string;

  @IsBoolean()
  trainingCronEnabled: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  trainingLookbackDays: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  digestLookbackDays: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  recoPerLike?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  recoPerRating?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  recoFavProduct?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  recoFavStore?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  recoViewedStore?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  recoViewedProduct?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  recoSubscribedStore?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  recoVendorPlanSortOrder?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  recoVendorPlanScore?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  recoTrendProductMax?: number | null;
}
