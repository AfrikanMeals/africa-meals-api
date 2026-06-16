import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, Max, Min } from 'class-validator';

export class UpdateStorageSettingsDto {
  @ApiProperty({ description: 'Compresse les images avant upload (JPEG/WebP)' })
  @IsBoolean()
  compressionEnabled: boolean;

  @ApiProperty({ description: 'Taille maximale fichier en Mo (1–50)', example: 5 })
  @IsInt()
  @Min(1)
  @Max(50)
  maxFileSizeMb: number;

  @ApiProperty({
    description: 'Moteur de stockage',
    enum: ['firebase', 'gcs', 's3', 'auto'],
  })
  @IsIn(['firebase', 'gcs', 's3', 'auto'])
  storageEngine: 'firebase' | 'gcs' | 's3' | 'auto';

  @ApiProperty({
    description:
      'Proxy API pour lire les médias GCS/S3 (GET /medias/public/…) au lieu des URLs directes',
  })
  @IsBoolean()
  mediaProxyEnabled: boolean;
}
