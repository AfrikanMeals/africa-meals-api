import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { UserModel } from './user.schema';

/** Notification affichée dans le centre de messages (liste fusionnée côté client). */
export enum AppNotificationScopeEnum {
  /** Tous les utilisateurs éligibles (filtrage futur : pays, rôle…). */
  GLOBAL = 'GLOBAL',
  /** Un seul destinataire. */
  USER = 'USER',
}

@Schema({
  timestamps: true,
  collection: 'app_notifications',
  toJSON: { virtuals: true },
})
export class AppNotificationModel extends Document {
  @Prop({ required: true, enum: AppNotificationScopeEnum })
  scope: AppNotificationScopeEnum;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: UserModel.name,
    required: false,
  })
  recipientUserId?: MongooseSchema.Types.ObjectId;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  body: string;

  @Prop({ required: false })
  type?: string;

  @Prop({ type: MongooseSchema.Types.Mixed, required: false })
  data?: Record<string, unknown>;
}

export const AppNotificationSchema =
  SchemaFactory.createForClass(AppNotificationModel);

AppNotificationSchema.index({ scope: 1, createdAt: -1 });
AppNotificationSchema.index({ scope: 1, recipientUserId: 1, createdAt: -1 });
