import {
  IsInt,
  IsISO8601,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class SubscriptionTrialEndingPayload {
  @IsMongoId()
  userId!: string;

  @IsMongoId()
  subscriptionId!: string;

  @IsOptional()
  @IsMongoId()
  storeId?: string;

  @IsString()
  @MaxLength(128)
  planName!: string;

  @IsInt()
  @Min(1)
  daysRemaining!: number;

  @IsISO8601()
  trialEndsAt!: string;
}

export type SubscriptionDomainEventPayload = SubscriptionTrialEndingPayload;
