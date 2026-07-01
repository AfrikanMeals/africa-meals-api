import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export const THEME_IMAGE_PURPOSES = [
  'mobile_tab_bg_light',
  'mobile_tab_bg_dark',
  'app_logo',
  'admin_logo',
] as const;

export type ThemeImagePurpose = (typeof THEME_IMAGE_PURPOSES)[number];

export class ThemeImageJsonDto {
  @IsString()
  @MinLength(32)
  imageBase64: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  filename?: string;

  @IsString()
  @IsIn(THEME_IMAGE_PURPOSES)
  purpose: ThemeImagePurpose;
}
