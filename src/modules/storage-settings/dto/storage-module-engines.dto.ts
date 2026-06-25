import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { StorageModuleEngineSetting } from '@schemas/storage-module.constants';

const MODULE_ENGINE_VALUES = [
  'default',
  'firebase',
  'gcs',
  's3',
  'minio',
  'auto',
] as const;

export class StorageModuleEnginesDto {
  @ApiProperty({
    description: 'Catalogue (plats, boissons, catégories)',
    enum: MODULE_ENGINE_VALUES,
  })
  @IsIn(MODULE_ENGINE_VALUES)
  catalog: StorageModuleEngineSetting;

  @ApiProperty({
    description: 'Profil boutique / utilisateur',
    enum: MODULE_ENGINE_VALUES,
  })
  @IsIn(MODULE_ENGINE_VALUES)
  profile: StorageModuleEngineSetting;

  @ApiProperty({
    description: 'Marketing (pub, codes cadeaux, offres)',
    enum: MODULE_ENGINE_VALUES,
  })
  @IsIn(MODULE_ENGINE_VALUES)
  marketing: StorageModuleEngineSetting;

  @ApiProperty({
    description: 'Chat (vocal, pièces jointes)',
    enum: MODULE_ENGINE_VALUES,
  })
  @IsIn(MODULE_ENGINE_VALUES)
  chat: StorageModuleEngineSetting;

  @ApiProperty({
    description: 'Système (annonces, légal, e-mails)',
    enum: MODULE_ENGINE_VALUES,
  })
  @IsIn(MODULE_ENGINE_VALUES)
  system: StorageModuleEngineSetting;
}
