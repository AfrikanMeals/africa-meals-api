import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
  CreateMarketingOfferListingDto,
  PatchMarketingOfferListingDto,
} from './dto/marketing-offer-listings.dto';
import { MarketingOfferListingsService } from './marketing-offer-listings.service';

@ApiTags('marketing-offer-listings')
@ApiBearerAuth('bearer')
@Controller('stores')
export class StoreMarketingOfferListingsController {
  @Inject(MarketingOfferListingsService)
  private readonly listings: MarketingOfferListingsService;

  @Get(':storeId/marketing-offer-listings')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Vendeur — offres stratégie liées à des produits.' })
  list(@Req() req: Request, @Param('storeId') storeId: string) {
    return this.listings.listForStore(storeId, req.user as UserModel);
  }

  @Post(':storeId/marketing-offer-listings')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Vendeur — lier un produit à une stratégie.' })
  create(
    @Req() req: Request,
    @Param('storeId') storeId: string,
    @Body() body: CreateMarketingOfferListingDto,
  ) {
    return this.listings.createForStore(storeId, body, req.user as UserModel);
  }

  @Patch(':storeId/marketing-offer-listings/:listingId')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Vendeur — modifier une offre stratégie.' })
  patch(
    @Req() req: Request,
    @Param('storeId') storeId: string,
    @Param('listingId') listingId: string,
    @Body() body: PatchMarketingOfferListingDto,
  ) {
    return this.listings.patchForStore(
      storeId,
      listingId,
      body,
      req.user as UserModel,
    );
  }

  @Delete(':storeId/marketing-offer-listings/:listingId')
  @UseGuards(JwtGuard)
  @HttpCode(204)
  @ApiOperation({ summary: 'Vendeur — retirer une offre stratégie.' })
  async delete(
    @Req() req: Request,
    @Param('storeId') storeId: string,
    @Param('listingId') listingId: string,
  ): Promise<void> {
    await this.listings.deleteForStore(
      storeId,
      listingId,
      req.user as UserModel,
    );
  }
}
