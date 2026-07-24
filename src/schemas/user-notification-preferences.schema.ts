import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { UserModel } from '@schemas/user.schema';

/** Préférences notifications client (push + email) — sync mobile ↔ API. */
@Schema({ timestamps: true, collection: 'user_notification_preferences' })
export class UserNotificationPreferencesModel {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: UserModel.name,
    required: true,
    unique: true,
    index: true,
  })
  userId: Types.ObjectId;

  /** Digest email recommandations / boutiques abonnées. */
  @Prop({ type: Boolean, default: false })
  emailRecommendations: boolean;

  /** Digest nouveautés boutiques suivies uniquement. */
  @Prop({ type: Boolean, default: false })
  emailStoreDigest: boolean;

  /** Marketing plateforme (promos générales). */
  @Prop({ type: Boolean, default: false })
  emailMarketing: boolean;

  /**
   * Canaux sync mobile (écran Notifications) — absents = legacy allow.
   * `false` explicite bloque le canal pour alertes livraison.
   */
  @Prop({ type: Boolean, required: false })
  pushEnabled?: boolean;

  /** Alertes transactionnelles e-mail (`pref_notif_email`). */
  @Prop({ type: Boolean, required: false })
  emailAlertsEnabled?: boolean;

  /** Catégorie Livraison / statut de livraison. */
  @Prop({ type: Boolean, required: false })
  shippingDeliveryEnabled?: boolean;

  @Prop({ type: Date, default: null })
  unsubscribedAt: Date | null;

  @Prop({ type: Number, default: 0 })
  consecutiveNonOpens: number;

  @Prop({ type: Date, default: null })
  pausedUntil: Date | null;
}

export type UserNotificationPreferencesDocument =
  HydratedDocument<UserNotificationPreferencesModel>;

export const UserNotificationPreferencesSchema = SchemaFactory.createForClass(
  UserNotificationPreferencesModel,
);
