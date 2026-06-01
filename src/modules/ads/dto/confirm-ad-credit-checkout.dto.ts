import { IsString, MinLength } from 'class-validator';

export class ConfirmAdCreditCheckoutDto {
  @IsString()
  @MinLength(1)
  sessionId: string;
}
