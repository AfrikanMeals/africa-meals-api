import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export enum CronJobLastRunStatusEnum {
  OK = 'ok',
  SKIPPED = 'skipped',
  ERROR = 'error',
}

@Schema({ timestamps: true, collection: 'infra_cron_job_states' })
export class InfraCronJobStateModel {
  @Prop({ type: String, required: true, unique: true, index: true })
  key: string;

  @Prop({ type: Boolean, default: false, name: 'paused' })
  paused: boolean;

  @Prop({ required: false, default: null, name: 'last_run_at' })
  lastRunAt?: Date | null;

  @Prop({
    type: String,
    enum: CronJobLastRunStatusEnum,
    required: false,
    default: null,
    name: 'last_run_status',
  })
  lastRunStatus?: CronJobLastRunStatusEnum | null;

  @Prop({ required: false, default: null, name: 'last_run_message' })
  lastRunMessage?: string | null;

  @Prop({ required: false, default: null, name: 'last_duration_ms' })
  lastDurationMs?: number | null;
}

export type InfraCronJobStateDocument =
  HydratedDocument<InfraCronJobStateModel>;

export const InfraCronJobStateSchema = SchemaFactory.createForClass(
  InfraCronJobStateModel,
);
