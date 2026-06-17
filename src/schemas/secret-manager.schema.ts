import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type SecretManagerScope = 'api' | 'ws';

@Schema({ _id: false })
export class SecretManagerEntryModel {
  @Prop({ type: String, required: true })
  envVarName: string;

  /** Si true (et manager global ON), la valeur DB est utilisée avec repli sur .env. */
  @Prop({ type: Boolean, default: false })
  dbEnabled: boolean;

  @Prop({ type: String, default: '', select: false })
  value: string;
}

export const SecretManagerEntrySchema =
  SchemaFactory.createForClass(SecretManagerEntryModel);

/** Paramètres Secret Manager par scope (`api` | `ws`). */
@Schema({ timestamps: true, collection: 'secret_manager_settings' })
export class SecretManagerScopeModel {
  @Prop({
    type: String,
    enum: ['api', 'ws'],
    unique: true,
    index: true,
  })
  scope: SecretManagerScope;

  /** Toggle global : OFF = toujours .env ; ON = DB + repli .env par clé activée. */
  @Prop({ type: Boolean, default: false })
  managerEnabled: boolean;

  @Prop({ type: [SecretManagerEntrySchema], default: [] })
  entries: SecretManagerEntryModel[];
}

export type SecretManagerScopeDocument =
  HydratedDocument<SecretManagerScopeModel>;

export const SecretManagerScopeSchema = SchemaFactory.createForClass(
  SecretManagerScopeModel,
);
