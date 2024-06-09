import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RatingModel, RatingSchema } from '@schemas/rating.schema';
import { RatingsController } from './ratings.controller';
import { RatingsService } from './ratings.service';

@Module({
  controllers: [RatingsController],
  providers: [RatingsService],
  imports: [
    MongooseModule.forFeature([
      { name: RatingModel.name, schema: RatingSchema },
    ]),
  ],
  exports: [RatingsService, MongooseModule],
})
export class RatingsModule {}
