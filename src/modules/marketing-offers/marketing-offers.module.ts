import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  MarketingOfferItemModel,
  MarketingOfferItemSchema,
  MarketingOfferModel,
  MarketingOfferSchema,
  MarketingOfferSectionModel,
  MarketingOfferSectionSchema,
} from '@schemas/marketing-offer.schema';
import { MarketingOffersController } from './marketing-offers.controller';
import { MarketingOffersService } from './marketing-offers.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MarketingOfferSectionModel.name, schema: MarketingOfferSectionSchema },
      { name: MarketingOfferModel.name, schema: MarketingOfferSchema },
      { name: MarketingOfferItemModel.name, schema: MarketingOfferItemSchema },
    ]),
  ],
  controllers: [MarketingOffersController],
  providers: [MarketingOffersService],
  exports: [MarketingOffersService],
})
export class MarketingOffersModule {}
