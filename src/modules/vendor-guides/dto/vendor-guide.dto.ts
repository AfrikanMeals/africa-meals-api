import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  VENDOR_GUIDE_SLUG_REGEX,
  VendorGuideActionTypeEnum,
} from '@schemas/vendor-guide.schema';

export class UpsertVendorGuideDto {
  @IsString()
  @Matches(VENDOR_GUIDE_SLUG_REGEX)
  slug: string;

  @IsString()
  @MaxLength(8)
  locale: string;

  @IsString()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  imageUrl?: string;

  @IsOptional()
  @IsString()
  htmlContent?: string;

  @IsOptional()
  @IsEnum(VendorGuideActionTypeEnum)
  actionType?: VendorGuideActionTypeEnum;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  actionLabel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  actionTarget?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateVendorGuideSettingsDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3650)
  sendAfterDays?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  articlesPerBatch?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3650)
  redisplayAfterDays?: number;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}

export class DismissVendorGuidesDto {
  @IsString({ each: true })
  guideSlugs: string[];

  @IsOptional()
  @IsString()
  @MaxLength(8)
  locale?: string;

  @IsOptional()
  @IsBoolean()
  skipped?: boolean;
}
