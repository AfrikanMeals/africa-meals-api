import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import { CreateRatingDto } from '@modules/ratings/dto/ratings.dto';
import {
  Body,
  Controller,
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
import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  @Inject(ProductsService)
  private readonly _productsService: ProductsService;

  @Get(':id')
  async getOneById(@Param('id') id: string) {
    return this._productsService.findOneById(id);
  }

  @Post(':id/rating')
  @UseGuards(JwtGuard)
  async rate(
    @Param('id') id: string,
    @Body(ValidationPipe) args: CreateRatingDto,
    @Req() req: Request,
  ) {
    return this._productsService.createRating(id, args, req.user as UserModel);
  }
}
