import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { LOYALTY_TIER_THRESHOLDS } from '@modules/loyalty/loyalty.constants';

@Schema({ _id: false })
export class LoyaltyTierSetting {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, default: 0 })
  min: number;

  @Prop({ required: false, default: null })
  max: number | null;

  @Prop({ required: true, default: '🥉' })
  icon: string;

  @Prop({ required: true, default: '#cd7f32' })
  color: string;

  @Prop({ required: true, default: '#1a1208' })
  bg: string;

  @Prop({ type: [String], default: [] })
  advantages: string[];
}

export const LoyaltyTierSettingSchema =
  SchemaFactory.createForClass(LoyaltyTierSetting);

/** Singleton programme fidélité (`key === 'default'`). */
@Schema({ timestamps: true, collection: 'loyalty_settings' })
export class LoyaltySettingsModel {
  @Prop({ type: String, default: 'default', unique: true, index: true })
  key: string;

  /** Jours sans commande avant statut « inactif ». */
  @Prop({ type: Number, default: 30 })
  inactiveDays: number;

  /** Montant FCFA dépensé pour gagner 1 point. */
  @Prop({ type: Number, default: 100 })
  fcfaPerPoint: number;

  /** Points offerts à l’activation admin du programme. */
  @Prop({ type: Number, default: 50 })
  welcomeBonusPoints: number;

  @Prop({
    type: [LoyaltyTierSettingSchema],
    default: () =>
      LOYALTY_TIER_THRESHOLDS.map((t) => ({
        name: t.name,
        min: t.min,
        max: t.max,
        icon: t.icon,
        color: t.color,
        bg: t.bg,
        advantages: [...t.advantages],
      })),
  })
  tiers: LoyaltyTierSetting[];
}

export type LoyaltySettingsDocument =
  HydratedDocument<LoyaltySettingsModel>;

export const LoyaltySettingsSchema = SchemaFactory.createForClass(
  LoyaltySettingsModel,
);
