import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/** Flags tracking portail admin (Matomo / GA / GTM / FB Pixel). */
@Schema({ _id: false })
export class PlatformAnalyticsAdminFlagsModel {
  @Prop({ type: Boolean, default: true })
  matomo: boolean;

  @Prop({ type: Boolean, default: true })
  ga: boolean;

  @Prop({ type: Boolean, default: true })
  gtm: boolean;

  @Prop({ type: Boolean, default: true })
  fbPixel: boolean;
}

export const PlatformAnalyticsAdminFlagsSchema = SchemaFactory.createForClass(
  PlatformAnalyticsAdminFlagsModel,
);

/** Flags tracking site vitrine. */
@Schema({ _id: false })
export class PlatformAnalyticsWebFlagsModel {
  @Prop({ type: Boolean, default: true })
  matomo: boolean;

  @Prop({ type: Boolean, default: true })
  ga: boolean;

  @Prop({ type: Boolean, default: true })
  gtm: boolean;
}

export const PlatformAnalyticsWebFlagsSchema = SchemaFactory.createForClass(
  PlatformAnalyticsWebFlagsModel,
);

/** Flags tracking app mobile (Firebase / GTM / Facebook). */
@Schema({ _id: false })
export class PlatformAnalyticsMobileFlagsModel {
  @Prop({ type: Boolean, default: true })
  firebase: boolean;

  @Prop({ type: Boolean, default: true })
  gtm: boolean;

  @Prop({ type: Boolean, default: true })
  facebook: boolean;
}

export const PlatformAnalyticsMobileFlagsSchema = SchemaFactory.createForClass(
  PlatformAnalyticsMobileFlagsModel,
);

/** Document singleton `key=default` — toggles analytics par surface. */
@Schema({ timestamps: true, collection: 'platform_analytics_settings' })
export class PlatformAnalyticsSettingsModel {
  @Prop({ type: String, default: 'default', unique: true, index: true })
  key: string;

  @Prop({
    type: PlatformAnalyticsAdminFlagsSchema,
    default: () => ({}),
  })
  admin: PlatformAnalyticsAdminFlagsModel;

  @Prop({
    type: PlatformAnalyticsWebFlagsSchema,
    default: () => ({}),
  })
  web: PlatformAnalyticsWebFlagsModel;

  @Prop({
    type: PlatformAnalyticsMobileFlagsSchema,
    default: () => ({}),
  })
  mobile: PlatformAnalyticsMobileFlagsModel;
}

export type PlatformAnalyticsSettingsDocument =
  HydratedDocument<PlatformAnalyticsSettingsModel>;

export const PlatformAnalyticsSettingsSchema = SchemaFactory.createForClass(
  PlatformAnalyticsSettingsModel,
);
