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
import {
  PreviewCartCouponDto,
  PreviewCartGiftCodeDto,
  UpdateCartLineQuantityDto,
  ValidateCheckoutDto,
} from './dto/cart.dto';
import { CartService } from './cart.service';

@ApiTags('cart')
@ApiBearerAuth('bearer')
@Controller('cart')
export class CartController {
  @Inject(CartService) private readonly _cartService: CartService;

  @Get('')
  @UseGuards(JwtGuard)
  async findAll(@Req() req: Request): Promise<any> {
    return this._cartService.filter(req.user as UserModel);
  }

  @Post('coupon/preview')
  @UseGuards(JwtGuard)
  async previewCoupon(
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    dto: PreviewCartCouponDto,
    @Req() req: Request,
  ) {
    return this._cartService.previewCouponForStore(
      req.user as UserModel,
      dto.storeId,
      dto.code,
    );
  }

  @Post('gift-code/preview')
  @UseGuards(JwtGuard)
  async previewGiftCode(
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    dto: PreviewCartGiftCodeDto,
    @Req() req: Request,
  ) {
    return this._cartService.previewGiftCodeForCart(
      req.user as UserModel,
      dto,
    );
  }

  /** Avant paiement : stocks (menu du jour, boissons) + validité des codes promo. */
  @Post('validate-checkout')
  @UseGuards(JwtGuard)
  async validateCheckout(
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    dto: ValidateCheckoutDto,
    @Req() req: Request,
  ) {
    return this._cartService.validateCheckoutReadiness(
      req.user as UserModel,
      dto ?? {},
    );
  }

  @Get('/:storeId')
  @UseGuards(JwtGuard)
  async findOneByStoreId(@Param('storeId') id: string, @Req() req: Request) {
    return this._cartService.findOneByStoreId(id, req.user as UserModel);
  }

  /** Vide tout le panier du client connecté (doit rester avant `DELETE :id`). */
  @Delete('me')
  @UseGuards(JwtGuard)
  async clearMine(@Req() req: Request): Promise<void> {
    await this._cartService.clearAllForUser(req.user as UserModel);
  }

  @Patch(':id/quantity')
  @UseGuards(JwtGuard)
  async updateLineQuantity(
    @Param('id') id: string,
    @Body(ValidationPipe) dto: UpdateCartLineQuantityDto,
    @Req() req: Request,
  ): Promise<void> {
    await this._cartService.setLineQuantity(
      id,
      dto.quantity,
      req.user as UserModel,
    );
  }

  @Delete(':id')
  @UseGuards(JwtGuard)
  async deleteOneById(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this._cartService.removeItemById(id, req.user as UserModel);
  }

  // @Post('')
  // @UseGuards(JwtGuard)
  // async addItemToCart(
  //   @Body(ValidationPipe) args: AddItemToCartDto,
  //   @Req() req: Request,
  // ) {
  //   return this._cartService.addItemToCart(args, req.user as UserModel);
  // }
}
