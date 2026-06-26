import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type DatabaseOperationType =
  | 'incremental'
  | 'full'
  | 'migration'
  | 'restore';

export type DatabaseOperationStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed';

@Schema({ _id: false })
export class DatabaseBackupCollectionMeta {
  @Prop({ type: String, required: true })
  name: string;

  @Prop({ type: Number, default: 0 })
  documentCount: number;

  @Prop({ type: String, default: '' })
  fileName: string;
}

export const DatabaseBackupCollectionMetaSchema = SchemaFactory.createForClass(
  DatabaseBackupCollectionMeta,
);

/** Historique sauvegardes / migrations / restaurations. */
@Schema({ timestamps: true, collection: 'database_backup_runs' })
export class DatabaseBackupRunModel {
  @Prop({
    type: String,
    enum: ['incremental', 'full', 'migration', 'restore'],
    required: true,
    index: true,
  })
  type: DatabaseOperationType;

  @Prop({
    type: String,
    enum: ['pending', 'running', 'completed', 'failed'],
    default: 'pending',
    index: true,
  })
  status: DatabaseOperationStatus;

  @Prop({ type: Types.ObjectId, ref: 'UserModel', index: true })
  triggeredBy?: Types.ObjectId;

  @Prop({ type: String, default: '' })
  triggeredByEmail: string;

  @Prop({ type: String, default: '' })
  jobId: string;

  @Prop({ type: String, default: '' })
  storagePath: string;

  @Prop({ type: Number, default: 0 })
  sizeBytes: number;

  @Prop({ type: [DatabaseBackupCollectionMetaSchema], default: [] })
  collections: DatabaseBackupCollectionMeta[];

  /** Résumé cible migration (hôte masqué, jamais de mot de passe). */
  @Prop({ type: String, default: '' })
  targetSummary: string;

  @Prop({ type: String, default: '' })
  errorMessage: string;

  @Prop({ type: Date, default: null })
  startedAt?: Date | null;

  @Prop({ type: Date, default: null })
  completedAt?: Date | null;
}

export type DatabaseBackupRunDocument =
  HydratedDocument<DatabaseBackupRunModel>;

export const DatabaseBackupRunSchema = SchemaFactory.createForClass(
  DatabaseBackupRunModel,
);

DatabaseBackupRunSchema.index({ createdAt: -1 });
