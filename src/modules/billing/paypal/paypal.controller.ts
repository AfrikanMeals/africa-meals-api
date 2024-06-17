import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';

@Controller('paypal')
export class PaypalController {
  @Get('success')
  @HttpCode(HttpStatus.OK)
  success() {
    return 'success';
  }

  @Get('cancel')
  @HttpCode(HttpStatus.OK)
  cancel() {
    return 'success';
  }
}
