import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdModel, AdSchema } from '@schemas/ad.schema';
import { AdsController } from './ads.controller';
import { AdsService } from './ads.service';

@Module({
  controllers: [AdsController],
  providers: [AdsService],
  imports: [
    MongooseModule.forFeature([{ name: AdModel.name, schema: AdSchema }]),
  ],
  exports: [AdsService],
})
export class AdsModule {}
