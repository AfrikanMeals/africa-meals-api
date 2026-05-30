import { ApiPropertyOptional } from '@nestjs/swagger';
import {
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
}
