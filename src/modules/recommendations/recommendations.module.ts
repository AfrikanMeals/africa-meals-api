import { AuthModule } from '@modules/auth/auth.module';
import { SearchModule } from '@modules/search/search.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DrinkModel, DrinkSchema } from '@schemas/drink.schema';
import { OrderModel, OrderSchema } from '@schemas/order.schema';
import { ProductModel, ProductSchema } from '@schemas/product.schema';
import {
  ProductRatingModel,
  ProductRatingSchema,
} from '@schemas/product_rating.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import {
  UserRecommendationSignalModel,
  UserRecommendationSignalSchema,
} from '@schemas/user-recommendation-signal.schema';
import {
  RecommendationTrainingSnapshotModel,
  RecommendationTrainingSnapshotSchema,
} from '@schemas/recommendation-training-snapshot.schema';
import {
  UserRecommendationDigestModel,
  UserRecommendationDigestSchema,
} from '@schemas/user-recommendation-digest.schema';
import { RecommendationTrainingCron } from './recommendation-training.cron';
import { RecommendationTrainingService } from './recommendation-training.service';
import { RecommendationsController } from './recommendations.controller';
import { RecommendationsService } from './recommendations.service';

@Module({
  imports: [
    AuthModule,
    SearchModule,
    MongooseModule.forFeature([
      {
        name: UserRecommendationSignalModel.name,
        schema: UserRecommendationSignalSchema,
      },
      { name: DrinkModel.name, schema: DrinkSchema },
      { name: OrderModel.name, schema: OrderSchema },
      { name: StoreModel.name, schema: StoreSchema },
      { name: ProductModel.name, schema: ProductSchema },
      { name: ProductRatingModel.name, schema: ProductRatingSchema },
      {
        name: RecommendationTrainingSnapshotModel.name,
        schema: RecommendationTrainingSnapshotSchema,
      },
      {
        name: UserRecommendationDigestModel.name,
        schema: UserRecommendationDigestSchema,
      },
    ]),
  ],
  controllers: [RecommendationsController],
  providers: [
    RecommendationsService,
    RecommendationTrainingService,
    RecommendationTrainingCron,
  ],
})
export class RecommendationsModule {}
