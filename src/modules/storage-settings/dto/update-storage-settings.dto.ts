import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, Max, Min, ValidateNested } from 'class-validator';
import { StorageEnginesEnabledDto } from './storage-engines-enabled.dto';

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
    enum: ['firebase', 'gcs', 's3', 'minio', 'auto'],
  })
  @IsIn(['firebase', 'gcs', 's3', 'minio', 'auto'])
  storageEngine: 'firebase' | 'gcs' | 's3' | 'minio' | 'auto';

  @ApiProperty({
    description:
      'Proxy API pour lire les médias GCS/S3 (GET /medias/public/…) au lieu des URLs directes',
  })
  @IsBoolean()
  mediaProxyEnabled: boolean;

  @ApiProperty({
    description: 'Activation par moteur (Firebase, GCS, S3)',
  })
  @ValidateNested()
  @Type(() => StorageEnginesEnabledDto)
  enginesEnabled: StorageEnginesEnabledDto;
}
