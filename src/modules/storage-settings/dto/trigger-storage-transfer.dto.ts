import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StorageEngineId } from '@schemas/storage-settings.schema';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';

const ENGINES: StorageEngineId[] = [
  'firebase',
  'gcs',
  's3',
  'minio',
  'r2',
  'vercelBlob',
];

export class TriggerStorageTransferDto {
  @ApiProperty({ enum: ENGINES })
  @IsIn(ENGINES)
  sourceEngine: StorageEngineId;

  @ApiProperty({ enum: ENGINES })
  @IsIn(ENGINES)
  targetEngine: StorageEngineId;

  @ApiPropertyOptional({
    description:
      'Si true, réécrit les objets déjà présents sur le moteur cible. Sinon, les fichiers existants sont ignorés.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  overrideExisting?: boolean;

  @ApiPropertyOptional({
    description: 'Inventaire seulement — aucune copie ni mise à jour MongoDB.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}
