import { AuthModule } from '@modules/auth/auth.module';
import { PartnerSubscriptionsModule } from '@modules/partner-subscriptions/partner-subscriptions.module';
import { SupportedCountriesModule } from '@modules/supported-countries/supported-countries.module';
import { TeamsModule } from '@modules/teams/teams.module';
import { UsageTimeModule } from '@modules/usage-time/usage-time.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  AdsTargetingProfileModel,
  AdsTargetingProfileSchema,
} from '@schemas/ads-targeting-profile.schema';
import { OrderModel, OrderSchema } from '@schemas/order.schema';
import { ProductModel, ProductSchema } from '@schemas/product.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import {
  UserRecommendationDigestModel,
  UserRecommendationDigestSchema,
} from '@schemas/user-recommendation-digest.schema';
import {
  UserRecommendationSignalModel,
  UserRecommendationSignalSchema,
} from '@schemas/user-recommendation-signal.schema';
import { UserModel, UserSchema } from '@schemas/user.schema';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: UserModel.name, schema: UserSchema },
      { name: AdsTargetingProfileModel.name, schema: AdsTargetingProfileSchema },
      {
        name: UserRecommendationDigestModel.name,
        schema: UserRecommendationDigestSchema,
      },
      {
        name: UserRecommendationSignalModel.name,
        schema: UserRecommendationSignalSchema,
      },
      { name: ProductModel.name, schema: ProductSchema },
      { name: StoreModel.name, schema: StoreSchema },
      { name: OrderModel.name, schema: OrderSchema },
    ]),
    TeamsModule,
    AuthModule,
    SupportedCountriesModule,
    UsageTimeModule,
    // Attach Partner referral depuis User Management.
    PartnerSubscriptionsModule,
  ],
  controllers: [AdminUsersController],
  providers: [AdminUsersService],
})
export class AdminUsersModule {}
