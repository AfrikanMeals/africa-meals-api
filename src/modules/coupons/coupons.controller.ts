import {
  CreateStoreCouponDto,
  PatchStoreCouponDto,
} from '@modules/coupons/dto/store-coupon.dto';
import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { CouponsService } from './coupons.service';

@ApiTags('coupons')
@ApiBearerAuth('bearer')
@Controller('coupons')
export class CouponsController {
  @Inject(CouponsService)
  private readonly _coupons: CouponsService;

  /** Liste : admin = tout, vendeur = ses boutiques uniquement. */
  @Get()
  @UseGuards(JwtGuard)
  async list(@Req() req: Request) {
    return this._coupons.listForUser(req.user as UserModel);
  }

  @Post()
  @UseGuards(JwtGuard)
  async create(
    @Req() req: Request,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: CreateStoreCouponDto,
  ) {
    return this._coupons.create(req.user as UserModel, body);
  }

  @Patch(':id')
  @UseGuards(JwtGuard)
  async patch(
    @Param('id') id: string,
    @Req() req: Request,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: PatchStoreCouponDto,
  ) {
    return this._coupons.patch(req.user as UserModel, id, body);
  }

  @Delete(':id')
  @UseGuards(JwtGuard)
  async delete(@Param('id') id: string, @Req() req: Request) {
    await this._coupons.remove(req.user as UserModel, id);
  }
}
