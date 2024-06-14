import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { CartService } from './cart.service';
import { AddItemToCartDto } from './dto/cart.dto';

@Controller('cart')
export class CartController {
  @Inject(CartService) private readonly _cartService: CartService;

  @Get('')
  @UseGuards(JwtGuard)
  async findAll(@Req() req: Request) {
    return this._cartService.filter(req.user as UserModel);
  }

  @Get(':id')
  @UseGuards(JwtGuard)
  async findOneById(@Param('id') id: string, @Req() req: Request) {
    return this._cartService.findOneById(id, req.user as UserModel);
  }

  @Delete(':id')
  @UseGuards(JwtGuard)
  async deleteOneById(@Param('id') id: string, @Req() req: Request) {
    return this._cartService.removeById(id, req.user as UserModel);
  }

  @Post('')
  @UseGuards(JwtGuard)
  async addItemToCart(
    @Body(ValidationPipe) args: AddItemToCartDto,
    @Req() req: Request,
  ) {
    return this._cartService.addItemToCart(args, req.user as UserModel);
  }
}
