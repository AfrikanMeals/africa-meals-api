import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  StockManagerSettingsModel,
  StockManagerSettingsSchema,
} from '@schemas/stock-manager-settings.schema';
import { StockManagerSettingsController } from './stock-manager-settings.controller';
import { StockManagerSettingsService } from './stock-manager-settings.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: StockManagerSettingsModel.name,
        schema: StockManagerSettingsSchema,
      },
    ]),
  ],
  controllers: [StockManagerSettingsController],
  providers: [StockManagerSettingsService],
  exports: [StockManagerSettingsService],
})
export class StockManagerSettingsModule {}
