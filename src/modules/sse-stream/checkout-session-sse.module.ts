import { Module } from '@nestjs/common';
import { CheckoutSessionSseService } from './checkout-session-sse.service';

@Module({
  providers: [CheckoutSessionSseService],
  exports: [CheckoutSessionSseService],
})
export class CheckoutSessionSseModule {}
