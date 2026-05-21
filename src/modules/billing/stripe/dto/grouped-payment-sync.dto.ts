import { IsString, Matches, MinLength } from 'class-validator';

export class GroupedPaymentSyncDto {
  @IsString()
  @MinLength(10)
  @Matches(/^pi_[a-zA-Z0-9]+$/, {
    message: 'paymentIntentId must be a Stripe PaymentIntent id (pi_…)',
  })
  paymentIntentId!: string;
}
