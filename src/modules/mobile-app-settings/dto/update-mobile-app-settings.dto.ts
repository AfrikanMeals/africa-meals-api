import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateIf,
} from 'class-validator';

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
}
