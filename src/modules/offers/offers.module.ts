import { ProductsModule } from '@modules/products/products.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OfferModel, OfferSchema } from '@schemas/offer.schema';
import { OffersController } from './offers.controller';
import { OffersService } from './offers.service';

@Module({
  controllers: [OffersController],
  providers: [OffersService],
  imports: [
    ProductsModule,
    MongooseModule.forFeature([{ name: OfferModel.name, schema: OfferSchema }]),
  ],
  exports: [OffersService, MongooseModule],
})
export class OffersModule {}
