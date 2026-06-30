import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { StorageEngineId } from '@schemas/storage-settings.schema';
import { HydratedDocument, Types } from 'mongoose';

export type StorageTransferStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed';

@Schema({ _id: false })
export class StorageTransferStatsModel {
  @Prop({ type: Number, default: 0 })
  scanned: number;

  @Prop({ type: Number, default: 0 })
  transferred: number;

  @Prop({ type: Number, default: 0 })
  skipped: number;

  @Prop({ type: Number, default: 0 })
  failed: number;

  @Prop({ type: Number, default: 0 })
  dbUpdated: number;
}

export const StorageTransferStatsSchema = SchemaFactory.createForClass(
  StorageTransferStatsModel,
);

@Schema({ timestamps: true, collection: 'storage_transfer_runs' })
export class StorageTransferRunModel {
  @Prop({
    type: String,
    enum: ['firebase', 'gcs', 's3', 'minio', 'r2'],
    required: true,
  })
  sourceEngine: StorageEngineId;

  @Prop({
    type: String,
    enum: ['firebase', 'gcs', 's3', 'minio', 'r2'],
    required: true,
  })
  targetEngine: StorageEngineId;

  @Prop({ type: Boolean, default: false })
  overrideExisting: boolean;

  @Prop({ type: Boolean, default: false })
  dryRun: boolean;

  @Prop({
    type: String,
    enum: ['pending', 'running', 'completed', 'failed'],
    default: 'pending',
    index: true,
  })
  status: StorageTransferStatus;

  @Prop({ type: Types.ObjectId, ref: 'UserModel', index: true })
  triggeredBy?: Types.ObjectId;

  @Prop({ type: String, default: '' })
  triggeredByEmail: string;

  @Prop({ type: String, default: '', index: true })
  jobId: string;

  @Prop({ type: StorageTransferStatsSchema, default: () => ({}) })
  stats: StorageTransferStatsModel;

  @Prop({ type: String, default: '' })
  errorMessage: string;

  @Prop({ type: Date, default: null })
  startedAt?: Date | null;

  @Prop({ type: Date, default: null })
  completedAt?: Date | null;
}

export type StorageTransferRunDocument =
  HydratedDocument<StorageTransferRunModel>;

export const StorageTransferRunSchema = SchemaFactory.createForClass(
  StorageTransferRunModel,
);

StorageTransferRunSchema.index({ createdAt: -1 });
