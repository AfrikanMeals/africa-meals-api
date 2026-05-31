import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

@Schema({ timestamps: true, collection: 'infra_runtime_settings' })
export class InfraRuntimeSettingsModel {
  @Prop({ type: String, default: 'default', unique: true, index: true })
  key: string;

  @Prop({ type: Boolean, default: true, name: 'redis_manager_enabled' })
  redisManagerEnabled: boolean;

  @Prop({ type: Boolean, default: true, name: 'mq_broker_enabled' })
  mqBrokerEnabled: boolean;
}

export type InfraRuntimeSettingsDocument =
  HydratedDocument<InfraRuntimeSettingsModel>;

export const InfraRuntimeSettingsSchema = SchemaFactory.createForClass(
  InfraRuntimeSettingsModel,
);
