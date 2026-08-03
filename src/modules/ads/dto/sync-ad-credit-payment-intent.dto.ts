import { IsString, MinLength } from 'class-validator';

/** Corps sync Payment Sheet Ad Credit (`paymentIntentId`). */
export class SyncAdCreditPaymentIntentDto {
  @IsString()
  @MinLength(3)
  paymentIntentId: string;
}
