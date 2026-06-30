import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ timestamps: true, collection: 'announcement_dismissals' })
export class AnnouncementDismissalModel {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  announcementId: Types.ObjectId;

  @Prop({ type: Date, default: Date.now })
  dismissedAt: Date;
}

export type AnnouncementDismissalDocument =
  HydratedDocument<AnnouncementDismissalModel>;

export const AnnouncementDismissalSchema = SchemaFactory.createForClass(
  AnnouncementDismissalModel,
);

AnnouncementDismissalSchema.index(
  { userId: 1, announcementId: 1 },
  { unique: true },
);
