import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/** Configuration SMTP additionnelle (Channels → Email). */
@Schema({ _id: false })
export class PlatformSmtpConfigModel {
  @Prop({ type: String, required: true, trim: true })
  id: string;

  @Prop({ type: String, required: true, trim: true })
  label: string;

  @Prop({ type: String, required: true, trim: true })
  host: string;

  @Prop({ type: Number, default: 587 })
  port: number;

  @Prop({ type: String, required: true, trim: true })
  user: string;

  @Prop({ type: String, default: '', trim: true })
  from: string;

  @Prop({ type: String, default: '', trim: true, name: 'from_name' })
  fromName: string;

  @Prop({ type: Boolean, default: false })
  secure: boolean;
}

export const PlatformSmtpConfigSchema =
  SchemaFactory.createForClass(PlatformSmtpConfigModel);
