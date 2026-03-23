import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  StockItemModel,
  StockItemSchema,
} from '@schemas/stock-item.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import { StockItemsService } from './stock-items.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: StockItemModel.name, schema: StockItemSchema },
      { name: StoreModel.name, schema: StoreSchema },
    ]),
  ],
  providers: [StockItemsService],
  exports: [StockItemsService],
})
export class StockItemsModule {}
