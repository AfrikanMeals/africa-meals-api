import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import { CreateRatingDto } from '@modules/ratings/dto/ratings.dto';
import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { ProductsService } from './products.service';

@ApiTags('products')
@Controller('products')
export class ProductsController {
  @Inject(ProductsService)
  private readonly _productsService: ProductsService;

  @Get('favorites/me')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtGuard)
  async myFavorites(
    @Req() req: Request,
    @Query('page') pageRaw?: string,
    @Query('take') takeRaw?: string,
  ) {
    if (pageRaw != null && pageRaw !== '') {
      const parsed = parseInt(pageRaw, 10);
      if (Number.isFinite(parsed) && parsed >= 1) {
        const take = Math.min(
          100,
          Math.max(1, parseInt(takeRaw ?? '20', 10) || 20),
        );
        return this._productsService.listFavoriteProducts(
          req.user as UserModel,
          { page: parsed, take },
        );
      }
    }
    return this._productsService.listFavoriteProducts(req.user as UserModel);
  }

  @Get(':id')
  async getOneById(@Param('id') id: string) {
    const doc = await this._productsService.findOneById(id);
    if (!doc) {
      throw new NotFoundException('product_not_found');
    }
    return doc;
  }

  @Post(':id/favorite')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtGuard)
  async addToFavorite(@Param('id') id: string, @Req() req: Request) {
    return this._productsService.addToFavorites(id, req.user as UserModel);
  }

  @Delete(':id/favorite')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtGuard)
  async removeFromFavorite(@Param('id') id: string, @Req() req: Request) {
    return this._productsService.removeFromFavorites(id, req.user as UserModel);
  }

  @Post(':id/rating')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtGuard)
  async rate(
    @Param('id') id: string,
    @Body(ValidationPipe) args: CreateRatingDto,
    @Req() req: Request,
  ) {
    return this._productsService.createRating(id, args, req.user as UserModel);
  }

  // @Delete(':id/extra/:title')
  // @UseGuards(JwtGuard)
  // async deleteExtra(
  //   @Param('id') id: string,
  //   @Param('title') title: string,
  //   @Req() req: Request,
  // ) {
  //   return this._productsService.deleteExtra(id, title, req.user as UserModel);
  // }
}
