import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { CartService } from './cart.service';

@Controller('cart')
export class CartController {
  @Inject(CartService) private readonly _cartService: CartService;

  @Get('')
  @UseGuards(JwtGuard)
  async findAll(@Req() req: Request) {
    return this._cartService.filter(req.user as UserModel);
  }

  @Get('/:storeId')
  @UseGuards(JwtGuard)
  async findOneByStoreId(@Param('storeId') id: string, @Req() req: Request) {
    return this._cartService.findOneByStoreId(id, req.user as UserModel);
  }

  @Delete(':id')
  @UseGuards(JwtGuard)
  async deleteOneById(@Param('id') id: string, @Req() req: Request) {
    return this._cartService.removeItemById(id, req.user as UserModel);
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
