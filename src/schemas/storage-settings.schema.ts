import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import {
  DEFAULT_MODULE_STORAGE_ENGINES,
  StorageModuleEngines,
} from './storage-module.constants';

export {
  DEFAULT_MODULE_STORAGE_ENGINES,
  STORAGE_MODULES,
  STORAGE_MODULE_LABELS,
  StorageModuleEngines,
  StorageModuleEngineSetting,
  StorageModuleId,
} from './storage-module.constants';

export type StorageEngineMode = 'firebase' | 'gcs' | 's3' | 'minio' | 'r2' | 'auto';

export type StorageEngineId = 'firebase' | 'gcs' | 's3' | 'minio' | 'r2';

export const STORAGE_ENGINE_IDS: StorageEngineId[] = [
  'firebase',
  'gcs',
  's3',
  'minio',
  'r2',
];

export type StorageEnginesEnabled = Record<StorageEngineId, boolean>;

export const DEFAULT_STORAGE_ENGINES_ENABLED: StorageEnginesEnabled = {
  firebase: true,
  gcs: true,
  s3: true,
  minio: true,
  r2: true,
};

/** Paramètres stockage fichiers (singleton `key=default`), pilotés depuis l’admin. */
@Schema({ timestamps: true, collection: 'storage_settings' })
export class StorageSettingsModel {
  @Prop({ type: String, default: 'default', unique: true, index: true })
  key: string;

  @Prop({ type: Boolean, default: false })
  compressionEnabled: boolean;

  @Prop({ type: Number, default: 5, min: 1, max: 50 })
  maxFileSizeMb: number;

  @Prop({
    type: String,
    enum: ['firebase', 'gcs', 's3', 'minio', 'r2', 'auto'],
    default: 'firebase',
  })
  storageEngine: StorageEngineMode;

  /**
   * Moteurs utilisés pour les uploads globaux. Un seul = déterministe ; plusieurs = tirage aléatoire.
   * `storageEngine` reste synchronisé (`auto` si pool > 1) pour compatibilité.
   */
  @Prop({
    type: [String],
    enum: ['firebase', 'gcs', 's3', 'minio', 'r2'],
    default: ['firebase'],
  })
  storageEnginePool: StorageEngineId[];

  /**
   * Moteur de secours si l’écriture échoue sur le moteur principal (null = désactivé).
   */
  @Prop({
    type: String,
    enum: ['firebase', 'gcs', 's3', 'minio', 'r2'],
    default: null,
    required: false,
  })
  fallbackStorageEngine: StorageEngineId | null;

  /** Si true, URLs GCS/S3 servies via GET /medias/public/… (bucket privé). */
  @Prop({ type: Boolean, default: false })
  mediaProxyEnabled: boolean;

  /** Moteurs disponibles pour upload / auto (admin peut en désactiver). */
  @Prop({
    type: {
      firebase: { type: Boolean, default: true },
      gcs: { type: Boolean, default: true },
      s3: { type: Boolean, default: true },
      minio: { type: Boolean, default: true },
      r2: { type: Boolean, default: true },
    },
    default: () => ({ ...DEFAULT_STORAGE_ENGINES_ENABLED }),
  })
  enginesEnabled: StorageEnginesEnabled;

  /** Moteur par module ; `default` = pool global (`storageEnginePool`). */
  @Prop({
    type: {
      catalog: {
        type: String,
        enum: ['default', 'firebase', 'gcs', 's3', 'minio', 'r2', 'auto'],
        default: 'default',
      },
      profile: {
        type: String,
        enum: ['default', 'firebase', 'gcs', 's3', 'minio', 'r2', 'auto'],
        default: 'default',
      },
      marketing: {
        type: String,
        enum: ['default', 'firebase', 'gcs', 's3', 'minio', 'r2', 'auto'],
        default: 'default',
      },
      chat: {
        type: String,
        enum: ['default', 'firebase', 'gcs', 's3', 'minio', 'r2', 'auto'],
        default: 'default',
      },
      system: {
        type: String,
        enum: ['default', 'firebase', 'gcs', 's3', 'minio', 'r2', 'auto'],
        default: 'default',
      },
    },
    default: () => ({ ...DEFAULT_MODULE_STORAGE_ENGINES }),
  })
  moduleStorageEngines: StorageModuleEngines;
}

export type StorageSettingsDocument =
  HydratedDocument<StorageSettingsModel>;

export const StorageSettingsSchema =
  SchemaFactory.createForClass(StorageSettingsModel);
