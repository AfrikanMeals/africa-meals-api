import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdatePlatformThemeSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  mobileTabBackgroundLightUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  mobileTabBackgroundDarkUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  appLogoUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  adminLogoUrl?: string;
}
