import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { AppNotificationModel } from './app-notification.schema';
import { UserModel } from './user.schema';

/**
 * Accusé de lecture par utilisateur et par notification (globale ou ciblée).
 */
@Schema({
  timestamps: false,
  collection: 'notification_read_receipts',
})
export class NotificationReadReceiptModel extends Document {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: UserModel.name,
    required: true,
  })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: AppNotificationModel.name,
    required: true,
  })
  notificationId: MongooseSchema.Types.ObjectId;

  @Prop({ default: () => new Date() })
  readAt: Date;
}

export const NotificationReadReceiptSchema = SchemaFactory.createForClass(
  NotificationReadReceiptModel,
);

NotificationReadReceiptSchema.index(
  { userId: 1, notificationId: 1 },
  { unique: true },
);
