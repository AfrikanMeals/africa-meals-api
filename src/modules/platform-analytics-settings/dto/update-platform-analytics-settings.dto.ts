import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, ValidateNested } from 'class-validator';

export class UpdatePlatformAnalyticsAdminDto {
  @IsOptional()
  @IsBoolean()
  matomo?: boolean;

  @IsOptional()
  @IsBoolean()
  ga?: boolean;

  @IsOptional()
  @IsBoolean()
  gtm?: boolean;

  @IsOptional()
  @IsBoolean()
  fbPixel?: boolean;
}

export class UpdatePlatformAnalyticsWebDto {
  @IsOptional()
  @IsBoolean()
  matomo?: boolean;

  @IsOptional()
  @IsBoolean()
  ga?: boolean;

  @IsOptional()
  @IsBoolean()
  gtm?: boolean;
}

export class UpdatePlatformAnalyticsMobileDto {
  @IsOptional()
  @IsBoolean()
  firebase?: boolean;

  @IsOptional()
  @IsBoolean()
  gtm?: boolean;

  @IsOptional()
  @IsBoolean()
  facebook?: boolean;
}

export class UpdatePlatformAnalyticsSettingsDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdatePlatformAnalyticsAdminDto)
  admin?: UpdatePlatformAnalyticsAdminDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpdatePlatformAnalyticsWebDto)
  web?: UpdatePlatformAnalyticsWebDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpdatePlatformAnalyticsMobileDto)
  mobile?: UpdatePlatformAnalyticsMobileDto;
}
