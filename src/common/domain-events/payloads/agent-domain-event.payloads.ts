import {
  IsIn,
  IsInt,
  IsISO8601,
  IsLatitude,
  IsLongitude,
  IsMongoId,
  IsNumber,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export const AGENT_PRESENCE_VALUES = [
  'available',
  'busy',
  'offline',
] as const;

export type AgentPresenceValue = (typeof AGENT_PRESENCE_VALUES)[number];

export class AgentPresenceChangedPayload {
  @IsMongoId()
  agentUserId!: string;

  @IsIn(AGENT_PRESENCE_VALUES)
  presence!: AgentPresenceValue;

  @IsOptional()
  @IsInt()
  @Min(0)
  activeOrderCount?: number;
}

export class AgentLocationUpdatedPayload {
  @IsMongoId()
  agentUserId!: string;

  @IsLatitude()
  latitude!: number;

  @IsLongitude()
  longitude!: number;

  @IsOptional()
  @IsMongoId()
  orderId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(360)
  headingDegrees?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(80)
  speedMps?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  batteryPercent?: number;

  @IsOptional()
  @IsISO8601()
  recordedAt?: string;
}

export class AgentCapacityChangedPayload {
  @IsMongoId()
  agentUserId!: string;

  @IsInt()
  @Min(1)
  maxConcurrentOrders!: number;
}

export type AgentDomainEventPayload =
  | AgentPresenceChangedPayload
  | AgentLocationUpdatedPayload
  | AgentCapacityChangedPayload;
