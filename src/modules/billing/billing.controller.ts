import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  Delete,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import type { DeleteResult } from 'mongodb';
import { BillingService } from './billing.service';
import { CreatePaymentMethodDto } from './paypal/dto/paypal.dto';
import { PaypalService } from './paypal/paypal.service';

@Controller('billing')
export class BillingController {
  @Inject(PaypalService) private readonly _paypalService: PaypalService;
  @Inject(BillingService) private readonly _billingService: BillingService;

  @Post('create-paypal-vault-token')
  @UseGuards(JwtGuard)
  async createPaypalVaultToken(
    @Req() req: Request,
    @Body(ValidationPipe) body: CreatePaymentMethodDto,
  ) {
    return await this._paypalService.createSetupToken(
      body,
      req.user as UserModel,
    );
  }

  @Post('create-paypal-payment-token/:setUpId')
  @UseGuards(JwtGuard)
  async savePaymentToken(
    @Param('setUpId') setUpId: string,
    @Req() req: Request,
  ) {
    return await this._billingService.savePaypalPaymentMethod(
      setUpId,
      req.user as UserModel,
    );
  }

  @Delete('payment-method/:id')
  @UseGuards(JwtGuard)
  async deletePaymentToken(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<DeleteResult> {
    return await this._billingService.deletePaypalPaymentMethod(
      id,
      req.user as UserModel,
    );
  }
}
