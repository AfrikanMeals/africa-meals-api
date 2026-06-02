import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/** Canaux optionnels facturés en add-on sur une bannière ou campagne. */
@Schema({ _id: false })
export class AdNotificationChannelsModel {
  @Prop({ type: Boolean, default: false, name: 'email' })
  email: boolean;

  @Prop({ type: Boolean, default: false, name: 'push' })
  push: boolean;

  @Prop({ type: Boolean, default: false, name: 'in_app' })
  inApp: boolean;

  @Prop({ type: Boolean, default: false, name: 'sms' })
  sms: boolean;
}

export const AdNotificationChannelsSchema = SchemaFactory.createForClass(
  AdNotificationChannelsModel,
);

@Schema({ _id: false })
export class AdNotificationAddonModel {
  @Prop({ type: Boolean, default: false, name: 'enabled' })
  enabled: boolean;

  @Prop({
    type: AdNotificationChannelsSchema,
    default: () => ({
      email: false,
      push: false,
      inApp: false,
      sms: false,
    }),
    name: 'channels',
  })
  channels: AdNotificationChannelsModel;
}

export const AdNotificationAddonSchema = SchemaFactory.createForClass(
  AdNotificationAddonModel,
);
