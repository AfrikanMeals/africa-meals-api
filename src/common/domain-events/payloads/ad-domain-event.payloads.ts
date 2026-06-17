import {
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class AdImpressionPayload {
  @IsMongoId()
  adId!: string;

  @IsOptional()
  @IsMongoId()
  storeId?: string;

  @IsOptional()
  @IsMongoId()
  customerUserId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  clientInstallId?: string;
}

export class AdClickPayload {
  @IsMongoId()
  adId!: string;

  @IsOptional()
  @IsMongoId()
  storeId?: string;

  @IsOptional()
  @IsMongoId()
  customerUserId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  clientInstallId?: string;
}

export class AdConversionPayload {
  @IsMongoId()
  adId!: string;

  @IsOptional()
  @IsMongoId()
  orderId?: string;

  @IsOptional()
  @IsMongoId()
  storeId?: string;

  @IsOptional()
  @IsMongoId()
  customerUserId?: string;
}

export type AdDomainEventPayload =
  | AdImpressionPayload
  | AdClickPayload
  | AdConversionPayload;
