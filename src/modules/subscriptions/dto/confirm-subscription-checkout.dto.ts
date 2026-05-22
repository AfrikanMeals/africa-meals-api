import { IsString, MinLength } from 'class-validator';

export class ConfirmSubscriptionCheckoutDto {
  @IsString()
  @MinLength(1)
  sessionId: string;
}
