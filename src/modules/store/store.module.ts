import { AddressesModule } from '@modules/addresses/addresses.module';
import { MediasModule } from '@modules/medias/medias.module';
import { RatingsModule } from '@modules/ratings/ratings.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import { StoreController } from './store.controller';
import { StoreService } from './store.service';

@Module({
  controllers: [StoreController],
  providers: [StoreService],
  imports: [
    RatingsModule,
    AddressesModule,
    MediasModule,
    MongooseModule.forFeature([{ name: StoreModel.name, schema: StoreSchema }]),
  ],
  exports: [StoreService, MongooseModule],
})
export class StoreModule {}
