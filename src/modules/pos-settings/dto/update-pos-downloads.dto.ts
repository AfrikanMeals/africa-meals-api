import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class UpdatePosDownloadsDto {
  @ApiPropertyOptional({ example: 'https://play.google.com/store/apps/details?id=com.wise.eat.pos' })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @ValidateIf((_, value) => String(value ?? '').trim().length > 0)
  @IsUrl({ require_protocol: true }, { message: 'androidDownloadUrl_invalid' })
  androidDownloadUrl?: string;

  @ApiPropertyOptional({ example: 'https://apps.apple.com/app/wise-eat-pos/id123' })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @ValidateIf((_, value) => String(value ?? '').trim().length > 0)
  @IsUrl({ require_protocol: true }, { message: 'iosDownloadUrl_invalid' })
  iosDownloadUrl?: string;

  @ApiPropertyOptional({ example: 'https://wise-eat.com/downloads/pos-macos.dmg' })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @ValidateIf((_, value) => String(value ?? '').trim().length > 0)
  @IsUrl({ require_protocol: true }, { message: 'macosDownloadUrl_invalid' })
  macosDownloadUrl?: string;

  @ApiPropertyOptional({ example: 'https://wise-eat.com/downloads/wise-eat-pos-setup.exe' })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @ValidateIf((_, value) => String(value ?? '').trim().length > 0)
  @IsUrl({ require_protocol: true }, { message: 'windowsDownloadUrl_invalid' })
  windowsDownloadUrl?: string;
}
