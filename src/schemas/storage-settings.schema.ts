import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type StorageEngineMode = 'firebase' | 'gcs' | 's3' | 'auto';

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
    enum: ['firebase', 'gcs', 's3', 'auto'],
    default: 'firebase',
  })
  storageEngine: StorageEngineMode;

  /** Si true, URLs GCS/S3 servies via GET /medias/public/… (bucket privé). */
  @Prop({ type: Boolean, default: false })
  mediaProxyEnabled: boolean;
}

export type StorageSettingsDocument =
  HydratedDocument<StorageSettingsModel>;

export const StorageSettingsSchema =
  SchemaFactory.createForClass(StorageSettingsModel);
