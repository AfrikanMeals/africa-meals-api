import { Module } from '@nestjs/common';
import { TeamsModule } from '@modules/teams/teams.module';
import { MongooseModule } from '@nestjs/mongoose';
import { StockItemModel, StockItemSchema } from '@schemas/stock-item.schema';
import { StockItemsService } from './stock-items.service';

@Module({
  imports: [
    TeamsModule,
    MongooseModule.forFeature([
      { name: StockItemModel.name, schema: StockItemSchema },
    ]),
  ],
  providers: [StockItemsService],
  exports: [StockItemsService],
})
export class StockItemsModule {}
