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

  @Get('admin')
  @UseGuards(JwtGuard)
  async listAdmin(@Req() req: Request) {
    return this._coupons.listForAdmin(req.user as UserModel);
  }

  @Post('admin')
  @UseGuards(JwtGuard)
  async createAdmin(
    @Req() req: Request,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: CreateStoreCouponDto,
  ) {
    return this._coupons.create(req.user as UserModel, body);
  }

  @Patch('admin/:id')
  @UseGuards(JwtGuard)
  async patchAdmin(
    @Param('id') id: string,
    @Req() req: Request,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: PatchStoreCouponDto,
  ) {
    return this._coupons.patch(req.user as UserModel, id, body);
  }

  @Delete('admin/:id')
  @UseGuards(JwtGuard)
  async deleteAdmin(@Param('id') id: string, @Req() req: Request) {
    await this._coupons.remove(req.user as UserModel, id);
  }
}
