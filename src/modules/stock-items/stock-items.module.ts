import { Module } from '@nestjs/common';
import { StockManagerSettingsModule } from '@modules/stock-manager-settings/stock-manager-settings.module';
import { TeamsModule } from '@modules/teams/teams.module';
import { MongooseModule } from '@nestjs/mongoose';
import { StockItemModel, StockItemSchema } from '@schemas/stock-item.schema';
import { StockItemsService } from './stock-items.service';

@Module({
  imports: [
    StockManagerSettingsModule,
    TeamsModule,
    MongooseModule.forFeature([
      { name: StockItemModel.name, schema: StockItemSchema },
    ]),
  ],
  providers: [StockItemsService],
  exports: [StockItemsService],
})
export class StockItemsModule {}
