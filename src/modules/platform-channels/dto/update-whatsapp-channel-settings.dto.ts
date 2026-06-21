import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateWhatsappChannelSettingsDto {
  /** Vide = retirer la surcharge DB (fallback .env). */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  workspaceId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  whatsappChannelId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  apiBaseUrl?: string;

  /** Non vide = enregistrer dans Secret Manager (si dbEnabled). */
  @IsOptional()
  @IsString()
  @MaxLength(8192)
  accessKey?: string;

  /** Utiliser la valeur DB du Secret Manager pour BIRD_ACCESS_KEY. */
  @IsOptional()
  @IsBoolean()
  accessKeyUseDatabase?: boolean;
}
