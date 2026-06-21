import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateTelegramChannelSettingsDto {
  /** Vide = retirer la surcharge DB (fallback .env). */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  apiBaseUrl?: string;

  /** Non vide = enregistrer dans Secret Manager (si dbEnabled). */
  @IsOptional()
  @IsString()
  @MaxLength(8192)
  botToken?: string;

  /** Utiliser la valeur DB du Secret Manager pour TELEGRAM_BOT_TOKEN. */
  @IsOptional()
  @IsBoolean()
  botTokenUseDatabase?: boolean;
}
