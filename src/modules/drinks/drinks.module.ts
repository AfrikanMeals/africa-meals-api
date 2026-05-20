import { MediasModule } from '@modules/medias/medias.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DrinkModel, DrinkSchema } from '@schemas/drink.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import { UserModel, UserSchema } from '@schemas/user.schema';
import { DrinksService } from './drinks.service';

@Module({
  imports: [
    MediasModule,
    MongooseModule.forFeature([
      { name: DrinkModel.name, schema: DrinkSchema },
      { name: StoreModel.name, schema: StoreSchema },
      { name: UserModel.name, schema: UserSchema },
    ]),
  ],
  providers: [DrinksService],
  exports: [DrinksService],
})
export class DrinksModule {}
