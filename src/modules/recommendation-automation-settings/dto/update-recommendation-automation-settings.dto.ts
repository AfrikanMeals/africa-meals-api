import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class UpdateRecommendationAutomationSettingsDto {
  @IsOptional()
  @IsBoolean()
  pushRecoEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  pushRecoRolloutPct?: number;

  @IsOptional()
  @IsBoolean()
  classifierCronEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  plannerCronEnabled?: boolean;

  @IsOptional()
  @IsString()
  classifierCronExpression?: string;

  @IsOptional()
  @IsString()
  plannerCronExpression?: string;

  @IsOptional()
  @IsBoolean()
  llmCopyEnabled?: boolean;

  @IsOptional()
  @IsString()
  llmModel?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  maxDaily?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(21)
  maxWeekly?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(48)
  minGapHours?: number;

  @IsOptional()
  @IsString()
  quietStart?: string;

  @IsOptional()
  @IsString()
  quietEnd?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  minScore?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  cuisineDiversityMaxPct?: number;

  @IsOptional()
  @IsBoolean()
  reorderFavoriteEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  dailyMenuMatchEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  storeReturnEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  trendingLocalEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  crossCuisineDiscoveryEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  promoEligibleEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  nearbyOpenEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  weightCuisineAffinity?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  weightProductAffinity?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  weightUrgency?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  weightNovelty?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  weightPromoMargin?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  weightPushFatigue?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  weightNotificationRecency?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  weightCuisineOverrepresentation?: number;
}
