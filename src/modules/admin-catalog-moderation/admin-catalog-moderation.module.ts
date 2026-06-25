import { TeamsModule } from '@modules/teams/teams.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DrinkModel, DrinkSchema } from '@schemas/drink.schema';
import { ProductModel, ProductSchema } from '@schemas/product.schema';
import { StockItemModel, StockItemSchema } from '@schemas/stock-item.schema';
import { AdminCatalogModerationController } from './admin-catalog-moderation.controller';
import { AdminCatalogModerationService } from './admin-catalog-moderation.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ProductModel.name, schema: ProductSchema },
      { name: DrinkModel.name, schema: DrinkSchema },
      { name: StockItemModel.name, schema: StockItemSchema },
    ]),
    TeamsModule,
  ],
  controllers: [AdminCatalogModerationController],
  providers: [AdminCatalogModerationService],
})
export class AdminCatalogModerationModule {}
