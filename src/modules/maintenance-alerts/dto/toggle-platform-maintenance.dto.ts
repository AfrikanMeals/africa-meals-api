import { MaintenancePlatformEnum } from '@schemas/platform-maintenance.schema';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class TogglePlatformMaintenanceDto {
  @IsEnum(MaintenancePlatformEnum)
  platform: MaintenancePlatformEnum;

  @IsBoolean()
  enabled: boolean;

  /** Envoyer un e-mail aux destinataires ops (défaut true côté service). */
  @IsOptional()
  @IsBoolean()
  sendEmailNotification?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}
