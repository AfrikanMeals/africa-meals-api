import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import { OptionalAuthGuard } from '@modules/auth/guards/optional.auth.guard';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import {
  MarketingOfferDealsFeedQueryDto,
  TrackMarketingOfferDealDto,
  DirectCheckoutMarketingOfferDealDto,
} from './dto/marketing-offer-listings.dto';
import { MarketingOfferListingsService } from './marketing-offer-listings.service';

@ApiTags('marketing-offer-deals')
@Controller('marketing-offer-deals')
export class MarketingOfferDealsController {
  @Inject(MarketingOfferListingsService)
  private readonly listings: MarketingOfferListingsService;

  @Get('feed')
  @UseGuards(OptionalAuthGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Feed accueil — 1 à 5 offres stratégie multi-boutiques.',
  })
  feed(@Req() req: Request, @Query() query: MarketingOfferDealsFeedQueryDto) {
    return this.listings.getExclusiveDealsFeed({
      take: query.take,
      regionCode: query.regionCode,
      user: req.user as UserModel | undefined,
    });
  }

  @Get('vendor-strategies')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Vendeur — stratégies approuvées éligibles checkout direct.',
  })
  listVendorStrategies() {
    return this.listings.listApprovedStrategiesForVendor();
  }

  @Get(':listingId/preview')
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({
    summary:
      'Aperçu offre exclusive (listing) — navigation Ads sans checkout direct.',
  })
  preview(@Param('listingId') listingId: string) {
    return this.listings.getDealPreviewByListingId(listingId);
  }

  @Post(':listingId/track')
  @HttpCode(204)
  @UseGuards(OptionalAuthGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Tracking engagement carrousel (clic / checkout).' })
  async track(
    @Param('listingId') listingId: string,
    @Body() body: TrackMarketingOfferDealDto,
  ): Promise<void> {
    await this.listings.trackDealEngagement(listingId, body.event);
  }

  @Post(':listingId/direct-checkout')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary:
      'Prépare le panier boutique (qty + prix stratégie) pour checkout direct.',
  })
  directCheckout(
    @Req() req: Request,
    @Param('listingId') listingId: string,
    @Body() body: DirectCheckoutMarketingOfferDealDto,
  ) {
    return this.listings.prepareDirectCheckout(
      listingId,
      req.user as UserModel,
      body?.quantity,
    );
  }
}
