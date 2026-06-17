import {
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsMongoId,
  IsOptional,
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
