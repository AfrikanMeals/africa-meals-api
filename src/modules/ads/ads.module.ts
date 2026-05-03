import { AuthModule } from '@modules/auth/auth.module';
import { MediasModule } from '@modules/medias/medias.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdEventModel, AdEventSchema } from '@schemas/ad-event.schema';
import { AdModel, AdSchema } from '@schemas/ad.schema';
import { ProductModel, ProductSchema } from '@schemas/product.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import { UserModel, UserSchema } from '@schemas/user.schema';
import { AdsController } from './ads.controller';
import { AdsService } from './ads.service';

@Module({
  controllers: [AdsController],
  providers: [AdsService],
  imports: [
    AuthModule,
    MediasModule,
    MongooseModule.forFeature([
      { name: AdModel.name, schema: AdSchema },
      { name: AdEventModel.name, schema: AdEventSchema },
      { name: StoreModel.name, schema: StoreSchema },
      { name: ProductModel.name, schema: ProductSchema },
      { name: UserModel.name, schema: UserSchema },
    ]),
  ],
  exports: [AdsService],
})
export class AdsModule {}
