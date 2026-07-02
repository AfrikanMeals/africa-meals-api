import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class UpdateNewsletterAutomationSettingsDto {
  @IsOptional()
  @IsBoolean()
  foodNewsletterEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  foodNewsletterRolloutPct?: number;

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
  @Max(7)
  maxWeekly?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(12)
  maxMonthly?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  minGapDays?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  maxSameStoreDays?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  pauseAfterNonOpensDays?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  pauseAfterNonOpensCount?: number;

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
  @IsInt()
  @Min(0)
  @Max(100)
  crossCuisineMaxPct?: number;

  @IsOptional()
  @IsString()
  sendWindowStart?: string;

  @IsOptional()
  @IsString()
  sendWindowEnd?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(120)
  jitterMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  batchSize?: number;

  @IsOptional()
  @IsBoolean()
  wiseEatWeeklyEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  storeSubscriberDigestEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  foodRecoDigestEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  subscribedStoresSectionEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  recommendedSectionEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  promoSectionEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  reorderSectionEnabled?: boolean;
}
