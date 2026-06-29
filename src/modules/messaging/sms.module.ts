import { Module } from '@nestjs/common';
import { SmsDispatchService } from './sms-dispatch.service';

@Module({
  providers: [SmsDispatchService],
  exports: [SmsDispatchService],
})
export class SmsModule {}
