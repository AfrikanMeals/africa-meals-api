import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { StorageEngineId } from '@schemas/storage-settings.schema';
import { StorageEnginesEnabledDto } from './storage-engines-enabled.dto';
import { StorageModuleEnginesDto } from './storage-module-engines.dto';

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
    description:
      'Moteurs utilisés pour les uploads globaux (1 = fixe, plusieurs = tirage aléatoire)',
    type: [String],
    enum: ['firebase', 'gcs', 's3', 'minio', 'r2'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(['firebase', 'gcs', 's3', 'minio', 'r2'], { each: true })
  storageEnginePool: StorageEngineId[];

  @ApiProperty({
    description:
      'Moteur de secours si l’écriture échoue sur le moteur principal (null = aucun)',
    enum: ['firebase', 'gcs', 's3', 'minio', 'r2'],
    nullable: true,
    required: false,
  })
  @IsOptional()
  @ValidateIf((_, value) => value != null)
  @IsIn(['firebase', 'gcs', 's3', 'minio', 'r2'])
  fallbackStorageEngine?: StorageEngineId | null;

  @ApiProperty({
    description:
      'Proxy API pour lire les médias GCS/S3/R2/MinIO (GET /medias/public/…) au lieu des URLs directes',
  })
  @IsBoolean()
  mediaProxyEnabled: boolean;

  @ApiProperty({
    description: 'Activation par moteur (Firebase, GCS, S3)',
  })
  @ValidateNested()
  @Type(() => StorageEnginesEnabledDto)
  enginesEnabled: StorageEnginesEnabledDto;

  @ApiProperty({
    description:
      'Moteur par module (`default` = moteur global). Catalogue, profil, marketing, chat, système.',
  })
  @ValidateNested()
  @Type(() => StorageModuleEnginesDto)
  moduleStorageEngines: StorageModuleEnginesDto;
}
