import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

/** Config version d’une plateforme (Android ou iOS). */
export class AppPlatformVersionConfigDto {
  @ApiPropertyOptional({ example: '2.4.1' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  versionNumber?: string;

  @ApiPropertyOptional({
    description: 'Build number entier (critère de gate)',
    example: '184',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  buildId?: string;

  @ApiPropertyOptional({
    description: 'HTML What’s new legacy (miroir FR||EN)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100_000)
  whatsNewHtml?: string;

  @ApiPropertyOptional({ description: 'HTML What’s new FR (TinyMCE)' })
  @IsOptional()
  @IsString()
  @MaxLength(100_000)
  whatsNewHtmlFr?: string;

  @ApiPropertyOptional({ description: 'HTML What’s new EN (TinyMCE)' })
  @IsOptional()
  @IsString()
  @MaxLength(100_000)
  whatsNewHtmlEn?: string;

  @ApiPropertyOptional({ description: 'Force update si outdated' })
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @ApiPropertyOptional({
    description: 'Date limite YYYY-MM-DD (countdown soft)',
    example: '2026-09-01',
  })
  @IsOptional()
  @ValidateIf((_, v) => v != null && String(v).trim().length > 0)
  @IsString()
  @MaxLength(32)
  updateBefore?: string | null;
}

export class AppVersioningDto {
  @ApiPropertyOptional({ type: AppPlatformVersionConfigDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AppPlatformVersionConfigDto)
  android?: AppPlatformVersionConfigDto;

  @ApiPropertyOptional({ type: AppPlatformVersionConfigDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AppPlatformVersionConfigDto)
  ios?: AppPlatformVersionConfigDto;
}

export class UpdateMobileAppSettingsDto {
  @ApiPropertyOptional({
    description: 'Lien App Store (iOS)',
    example: 'https://apps.apple.com/app/id1234567890',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @ValidateIf((_, value) => String(value ?? '').trim().length > 0)
  @IsUrl({ require_protocol: true }, { message: 'appStoreUrl_invalid' })
  appStoreUrl?: string;

  @ApiPropertyOptional({
    description: 'Lien Play Store (Android)',
    example: 'https://play.google.com/store/apps/details?id=com.example.app',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @ValidateIf((_, value) => String(value ?? '').trim().length > 0)
  @IsUrl({ require_protocol: true }, { message: 'playStoreUrl_invalid' })
  playStoreUrl?: string;

  @ApiPropertyOptional({
    description: 'Lien page Facebook',
    example: 'https://www.facebook.com/wiseeat',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @ValidateIf((_, value) => String(value ?? '').trim().length > 0)
  @IsUrl({ require_protocol: true }, { message: 'facebookUrl_invalid' })
  facebookUrl?: string;

  @ApiPropertyOptional({
    description: 'Lien page Instagram',
    example: 'https://www.instagram.com/wiseeat',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @ValidateIf((_, value) => String(value ?? '').trim().length > 0)
  @IsUrl({ require_protocol: true }, { message: 'instagramUrl_invalid' })
  instagramUrl?: string;

  @ApiPropertyOptional({
    description: 'Lien page TikTok',
    example: 'https://www.tiktok.com/@wiseeat',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @ValidateIf((_, value) => String(value ?? '').trim().length > 0)
  @IsUrl({ require_protocol: true }, { message: 'tiktokUrl_invalid' })
  tiktokUrl?: string;

  @ApiPropertyOptional({
    description: 'Lien page X (Twitter)',
    example: 'https://x.com/wiseeat',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @ValidateIf((_, value) => String(value ?? '').trim().length > 0)
  @IsUrl({ require_protocol: true }, { message: 'xUrl_invalid' })
  xUrl?: string;

  @ApiPropertyOptional({
    description: 'Lien chaine YouTube',
    example: 'https://www.youtube.com/@wiseeat',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @ValidateIf((_, value) => String(value ?? '').trim().length > 0)
  @IsUrl({ require_protocol: true }, { message: 'youtubeUrl_invalid' })
  youtubeUrl?: string;

  @ApiPropertyOptional({
    description: 'Lien page Snapchat',
    example: 'https://www.snapchat.com/add/wiseeat',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @ValidateIf((_, value) => String(value ?? '').trim().length > 0)
  @IsUrl({ require_protocol: true }, { message: 'snapchatUrl_invalid' })
  snapchatUrl?: string;

  @ApiPropertyOptional({
    description: 'Lien page LinkedIn',
    example: 'https://www.linkedin.com/company/wiseeat',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @ValidateIf((_, value) => String(value ?? '').trim().length > 0)
  @IsUrl({ require_protocol: true }, { message: 'linkedinUrl_invalid' })
  linkedinUrl?: string;

  @ApiPropertyOptional({
    description: 'Lien page Pinterest',
    example: 'https://www.pinterest.com/wiseeat',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @ValidateIf((_, value) => String(value ?? '').trim().length > 0)
  @IsUrl({ require_protocol: true }, { message: 'pinterestUrl_invalid' })
  pinterestUrl?: string;

  @ApiPropertyOptional({
    description: 'E-mail de contact public',
    example: 'help@wise-eat.com',
  })
  @IsOptional()
  @IsString()
  @MaxLength(254)
  @ValidateIf((_, value) => String(value ?? '').trim().length > 0)
  @IsEmail({}, { message: 'contactEmail_invalid' })
  contactEmail?: string;

  @ApiPropertyOptional({
    description: 'Numéro de téléphone de contact public',
    example: '+1 514 555 0100',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  contactPhone?: string;

  @ApiPropertyOptional({
    description: 'E-mail principal public',
    example: 'contact@wise-eat.com',
  })
  @IsOptional()
  @IsString()
  @MaxLength(254)
  @ValidateIf((_, value) => String(value ?? '').trim().length > 0)
  @IsEmail({}, { message: 'mainEmail_invalid' })
  mainEmail?: string;

  @ApiPropertyOptional({
    description: 'Numéro WhatsApp public (format international recommandé)',
    example: '+1 514 555 0100',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  whatsappNumber?: string;

  @ApiPropertyOptional({ type: AppVersioningDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AppVersioningDto)
  appVersioning?: AppVersioningDto;
}
