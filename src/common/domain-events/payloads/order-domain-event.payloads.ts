import {
  IsIn,
  IsLatitude,
  IsLongitude,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

/** Valeurs alignées sur `OrderStatusEnum` sans dépendance schéma Mongoose. */
export const ORDER_DOMAIN_STATUS_VALUES = [
  'created',
  'paied',
  'approved',
  'cancelled',
  'shipped',
  'completed',
] as const;

export type OrderDomainStatus = (typeof ORDER_DOMAIN_STATUS_VALUES)[number];

export class OrderCreatedPayload {
  @IsMongoId()
  orderId!: string;

  @IsMongoId()
  storeId!: string;

  @IsMongoId()
  customerUserId!: string;

  @IsIn(ORDER_DOMAIN_STATUS_VALUES)
  status!: OrderDomainStatus;
}

export class OrderPaidPayload {
  @IsMongoId()
  orderId!: string;

  @IsMongoId()
  storeId!: string;

  @IsMongoId()
  customerUserId!: string;

  @IsNumber()
  @Min(0)
  amountCents!: number;

  @IsString()
  @MaxLength(8)
  currency!: string;
}

export class OrderApprovedPayload {
  @IsMongoId()
  orderId!: string;

  @IsMongoId()
  actorUserId!: string;
}

export class OrderShippedPayload {
  @IsMongoId()
  orderId!: string;

  @IsOptional()
  @IsMongoId()
  assignedDeliveryUserId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  courier?: string;
}

export class OrderDeliveredPayload {
  @IsMongoId()
  orderId!: string;
}

export class OrderCancelledPayload {
  @IsMongoId()
  orderId!: string;

  @IsString()
  @MaxLength(512)
  reason!: string;

  @IsString()
  @MaxLength(64)
  source!: string;
}

export class OrderTrackingUpdatedPayload {
  @IsMongoId()
  orderId!: string;

  @IsLatitude()
  latitude!: number;

  @IsLongitude()
  longitude!: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  eta?: string;
}

export type OrderDomainEventPayload =
  | OrderCreatedPayload
  | OrderPaidPayload
  | OrderApprovedPayload
  | OrderShippedPayload
  | OrderDeliveredPayload
  | OrderCancelledPayload
  | OrderTrackingUpdatedPayload;
