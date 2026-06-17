import {
  IsArray,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class PaymentCheckoutCompletedPayload {
  @IsString()
  @MaxLength(256)
  sessionId!: string;

  @IsOptional()
  @IsMongoId()
  userId?: string;

  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  orderIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(64)
  kind?: string;
}

export class PaymentIntentSucceededPayload {
  @IsString()
  @MaxLength(256)
  paymentIntentId!: string;

  @IsNumber()
  @Min(0)
  amountCents!: number;

  @IsString()
  @MaxLength(8)
  currency!: string;

  @IsOptional()
  @IsMongoId()
  userId?: string;
}

export class PaymentConnectAccountUpdatedPayload {
  @IsString()
  @MaxLength(256)
  accountId!: string;

  @IsOptional()
  @IsMongoId()
  userId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  status?: string;
}

export class SubscriptionCheckoutCompletedPayload {
  @IsString()
  @MaxLength(256)
  sessionId!: string;

  @IsMongoId()
  userId!: string;

  @IsOptional()
  @IsMongoId()
  storeId?: string;
}

export type PaymentDomainEventPayload =
  | PaymentCheckoutCompletedPayload
  | PaymentIntentSucceededPayload
  | PaymentConnectAccountUpdatedPayload
  | SubscriptionCheckoutCompletedPayload;
