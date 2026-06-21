import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  IsNumber,
} from 'class-validator';

export class UpdateEmailChannelSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  emailEngine?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8192)
  resendApiKey?: string;

  @IsOptional()
  @IsBoolean()
  resendApiKeyUseDatabase?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(8192)
  sendgridApiKey?: string;

  @IsOptional()
  @IsBoolean()
  sendgridApiKeyUseDatabase?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(8192)
  birdAccessKey?: string;

  @IsOptional()
  @IsBoolean()
  birdAccessKeyUseDatabase?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  birdWorkspaceId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  birdEmailChannelId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  birdApiBaseUrl?: string;

  /** moduleId → engine (any, auto, default, bird, resend, sendgrid, smtp:{id}). */
  @IsOptional()
  @IsObject()
  moduleEngines?: Record<string, string>;
}

export class UpsertPlatformSmtpConfigDto {
  @IsString()
  @MaxLength(120)
  label: string;

  @IsString()
  @MaxLength(255)
  host: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  port?: number;

  @IsString()
  @MaxLength(255)
  user: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  from?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  fromName?: string;

  @IsOptional()
  @IsBoolean()
  secure?: boolean;

  /** Non vide = enregistrer / remplacer le mot de passe (Secret Manager). */
  @IsOptional()
  @IsString()
  @MaxLength(8192)
  appPassword?: string;
}
