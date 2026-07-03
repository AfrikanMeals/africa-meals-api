import { AuthModule } from '@modules/auth/auth.module';
import { CartModule } from '@modules/cart/cart.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  MarketingOfferListingModel,
  MarketingOfferListingSchema,
} from '@schemas/marketing-offer-listing.schema';
import {
  MarketingOfferModel,
  MarketingOfferSchema,
} from '@schemas/marketing-offer.schema';
import { ProductModel, ProductSchema } from '@schemas/product.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import {
  UserRecommendationSignalModel,
  UserRecommendationSignalSchema,
} from '@schemas/user-recommendation-signal.schema';
import { MarketingOfferDealsController } from './marketing-offer-deals.controller';
import { MarketingOfferListingsService } from './marketing-offer-listings.service';
import { StoreMarketingOfferListingsController } from './store-marketing-offer-listings.controller';

@Module({
  imports: [
    AuthModule,
    CartModule,
    MongooseModule.forFeature([
      {
        name: MarketingOfferListingModel.name,
        schema: MarketingOfferListingSchema,
      },
      { name: MarketingOfferModel.name, schema: MarketingOfferSchema },
      { name: ProductModel.name, schema: ProductSchema },
      { name: StoreModel.name, schema: StoreSchema },
      {
        name: UserRecommendationSignalModel.name,
        schema: UserRecommendationSignalSchema,
      },
    ]),
  ],
  controllers: [
    MarketingOfferDealsController,
    StoreMarketingOfferListingsController,
  ],
  providers: [MarketingOfferListingsService],
  exports: [MarketingOfferListingsService],
})
export class MarketingOfferListingsModule {}
