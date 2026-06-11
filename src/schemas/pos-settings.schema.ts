import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/** Liens de téléchargement Wise Eat POS (singleton `key=default`). */
@Schema({ timestamps: true, collection: 'pos_settings' })
export class PosSettingsModel {
  @Prop({ type: String, default: 'default', unique: true, index: true })
  key: string;

  @Prop({ type: String, default: '' })
  androidDownloadUrl: string;

  @Prop({ type: String, default: '' })
  iosDownloadUrl: string;

  @Prop({ type: String, default: '' })
  macosDownloadUrl: string;

  @Prop({ type: String, default: '' })
  windowsDownloadUrl: string;
}

export type PosSettingsDocument = HydratedDocument<PosSettingsModel>;

export const PosSettingsSchema = SchemaFactory.createForClass(PosSettingsModel);
