import { IsString, Matches, MinLength } from 'class-validator';

export class SyncSubscriptionPaymentDto {
  @IsString()
  @MinLength(1)
  @Matches(/^pi_/)
  paymentIntentId: string;
}
