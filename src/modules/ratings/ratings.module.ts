import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ProductRatingModel,
  ProductRatingSchema,
} from '@schemas/product_rating.schema';
import {
  StoreRatingModel,
  StoreRatingSchema,
} from '@schemas/store_rating.schema';
import { RatingsController } from './ratings.controller';
import { RatingsService } from './ratings.service';

@Module({
  controllers: [RatingsController],
  providers: [RatingsService],
  imports: [
    MongooseModule.forFeature([
      { name: ProductRatingModel.name, schema: ProductRatingSchema },
      { name: StoreRatingModel.name, schema: StoreRatingSchema },
    ]),
  ],
  exports: [RatingsService, MongooseModule],
})
export class RatingsModule {}
