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

  /**
   * Si true : dispatches API → WS via gRPC (voir docs/GRPC_INTEGRATION.md).
   * Si false : HTTP interne + MQTT/BullMQ (comportement actuel).
   */
  @Prop({ type: Boolean, default: false, name: 'grpc_ws_notify_enabled' })
  grpcWsNotifyEnabled: boolean;
}

export type InfraRuntimeSettingsDocument =
  HydratedDocument<InfraRuntimeSettingsModel>;

export const InfraRuntimeSettingsSchema = SchemaFactory.createForClass(
  InfraRuntimeSettingsModel,
);
