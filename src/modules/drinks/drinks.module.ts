import { MediasModule } from '@modules/medias/medias.module';
import { SubscriptionsModule } from '@modules/subscriptions/subscriptions.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DrinkModel, DrinkSchema } from '@schemas/drink.schema';
import { ProductModel, ProductSchema } from '@schemas/product.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import { UserModel, UserSchema } from '@schemas/user.schema';
import { DrinksService } from './drinks.service';

@Module({
  imports: [
    MediasModule,
    SubscriptionsModule,
    MongooseModule.forFeature([
      { name: DrinkModel.name, schema: DrinkSchema },
      { name: ProductModel.name, schema: ProductSchema },
      { name: StoreModel.name, schema: StoreSchema },
      { name: UserModel.name, schema: UserSchema },
    ]),
  ],
  providers: [DrinksService],
  exports: [DrinksService],
})
export class DrinksModule {}
