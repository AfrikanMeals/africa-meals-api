import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/** Configuration légale plateforme (singleton `key=default`) — variables de template. */
@Schema({ timestamps: true, collection: 'platform_legal_settings' })
export class PlatformLegalSettingsModel {
  @Prop({ type: String, default: 'default', unique: true, index: true })
  key: string;

  @Prop({ type: String, default: 'SenTech' })
  companyLegalName: string;

  @Prop({ type: String, default: 'Wise Eat' })
  tradeName: string;

  @Prop({ type: String, default: 'https://wise-eat.com' })
  websiteUrl: string;

  @Prop({ type: String, default: 'help@wise-eat.com' })
  supportEmail: string;

  @Prop({ type: String, default: 'help@wise-eat.com' })
  privacyEmail: string;

  @Prop({ type: String, default: 'help@wise-eat.com' })
  legalEmail: string;

  @Prop({ type: String, default: '' })
  registeredAddress: string;

  @Prop({ type: String, default: 'Canada' })
  jurisdictionCountry: string;

  /** Ex. « lois du Canada et du Québec » / « laws of Canada and Quebec » */
  @Prop({ type: String, default: 'lois du Canada et du Québec' })
  governingLawFr: string;

  @Prop({ type: String, default: 'laws of Canada and Quebec' })
  governingLawEn: string;

  @Prop({ type: Number, default: 16 })
  minimumAge: number;

  @Prop({ type: Number, default: 30 })
  accountDeletionGraceDays: number;

  @Prop({ type: String, default: 'Stripe, PayPal' })
  paymentProvidersFr: string;

  @Prop({ type: String, default: 'Stripe, PayPal' })
  paymentProvidersEn: string;

  @Prop({ type: String, default: 'Mapbox, Google Maps' })
  mapProvidersFr: string;

  @Prop({ type: String, default: 'Mapbox, Google Maps' })
  mapProvidersEn: string;

  /** Date affichée dans les documents (ISO ou texte libre). */
  @Prop({ type: String, default: '' })
  lastUpdatedLabel: string;

  @Prop({ type: String, default: '/privacy' })
  privacyPath: string;

  @Prop({ type: String, default: '/terms' })
  termsPath: string;

  @Prop({ type: String, default: '/policy' })
  policyIndexPath: string;

  @Prop({ type: String, default: '/contact' })
  contactPath: string;

  @Prop({ type: String, default: '/status' })
  statusPath: string;
}

export type PlatformLegalSettingsDocument =
  HydratedDocument<PlatformLegalSettingsModel>;

export const PlatformLegalSettingsSchema = SchemaFactory.createForClass(
  PlatformLegalSettingsModel,
);
