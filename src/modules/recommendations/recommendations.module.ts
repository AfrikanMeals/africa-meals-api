import { AuthModule } from '@modules/auth/auth.module';
import { DrinksModule } from '@modules/drinks/drinks.module';
import { SearchModule } from '@modules/search/search.module';
import { SearchSettingsModule } from '@modules/search-settings/search-settings.module';
import { StoreSubscribersModule } from '@modules/store-subscribers/store-subscribers.module';
import { SubscriptionsModule } from '@modules/subscriptions/subscriptions.module';
import { SupportedCountriesModule } from '@modules/supported-countries/supported-countries.module';
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
    DrinksModule,
    SearchModule,
    SearchSettingsModule,
    SubscriptionsModule,
    StoreSubscribersModule,
    SupportedCountriesModule,
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
  exports: [RecommendationsService],
})
export class RecommendationsModule {}
