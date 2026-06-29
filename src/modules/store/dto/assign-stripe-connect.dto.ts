import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class AssignStripeConnectDto {
  @ApiProperty({
    description: 'Identifiant compte Stripe Connect (ex. acct_…)',
    example: 'acct_1ABC123',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^acct_[A-Za-z0-9]+$/, {
    message: 'invalid_stripe_account_id',
  })
  stripeAccountId: string;
}
