import { SmsEngineEnum } from '@schemas/maintenance-alert-settings.schema';
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';

export class UpdateSmsChannelSettingsDto {
  @IsOptional()
  @IsEnum(SmsEngineEnum)
  smsEngine?: SmsEngineEnum;

  @IsOptional()
  @IsString()
  birdWorkspaceId?: string;

  @IsOptional()
  @IsString()
  birdSmsChannelId?: string;

  @IsOptional()
  @IsString()
  birdApiBaseUrl?: string;

  @IsOptional()
  @IsString()
  birdAccessKey?: string;

  @IsOptional()
  @IsBoolean()
  birdAccessKeyUseDatabase?: boolean;

  @IsOptional()
  @IsString()
  twilioAccountSid?: string;

  @IsOptional()
  @IsBoolean()
  twilioAccountSidUseDatabase?: boolean;

  @IsOptional()
  @IsString()
  twilioAuthToken?: string;

  @IsOptional()
  @IsBoolean()
  twilioAuthTokenUseDatabase?: boolean;

  @IsOptional()
  @IsString()
  twilioSmsFrom?: string;
}
