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
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import {
  CreateMarketingOfferItemDto,
  PatchMarketingOfferItemDto,
  PatchMarketingOfferModerationDto,
} from './dto/marketing-offers.dto';
import { MarketingOffersService } from './marketing-offers.service';

@ApiTags('marketing-offers')
@ApiBearerAuth('bearer')
@Controller('marketing-offers')
export class MarketingOffersController {
  @Inject(MarketingOffersService)
  private readonly marketingOffers: MarketingOffersService;

  @Get('admin')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Admin — catalogue offres marketing groupé par section.' })
  listAdmin(@Req() req: Request) {
    return this.marketingOffers.listGroupedForAdmin(req.user as UserModel);
  }

  @Patch('admin/:offerId/moderation')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Admin — approuver ou bloquer une offre.' })
  patchModeration(
    @Req() req: Request,
    @Param('offerId') offerId: string,
    @Body() body: PatchMarketingOfferModerationDto,
  ) {
    return this.marketingOffers.patchModerationForAdmin(
      req.user as UserModel,
      offerId,
      body,
    );
  }

  @Get('admin/:offerId/items')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Admin — éléments d’une offre marketing.' })
  listItems(@Req() req: Request, @Param('offerId') offerId: string) {
    return this.marketingOffers.listItemsForAdmin(req.user as UserModel, offerId);
  }

  @Post('admin/:offerId/items')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Admin — créer un élément d’offre.' })
  createItem(
    @Req() req: Request,
    @Param('offerId') offerId: string,
    @Body() body: CreateMarketingOfferItemDto,
  ) {
    return this.marketingOffers.createItemForAdmin(
      req.user as UserModel,
      offerId,
      body,
    );
  }

  @Patch('admin/:offerId/items/:itemId')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Admin — modifier un élément d’offre.' })
  patchItem(
    @Req() req: Request,
    @Param('offerId') offerId: string,
    @Param('itemId') itemId: string,
    @Body() body: PatchMarketingOfferItemDto,
  ) {
    return this.marketingOffers.patchItemForAdmin(
      req.user as UserModel,
      offerId,
      itemId,
      body,
    );
  }

  @Delete('admin/:offerId/items/:itemId')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Admin — supprimer un élément d’offre.' })
  async deleteItem(
    @Req() req: Request,
    @Param('offerId') offerId: string,
    @Param('itemId') itemId: string,
  ) {
    await this.marketingOffers.deleteItemForAdmin(
      req.user as UserModel,
      offerId,
      itemId,
    );
    return { ok: true };
  }
}
