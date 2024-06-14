import { OffersModule } from '@modules/offers/offers.module';
import { ProductsModule } from '@modules/products/products.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CartItemModel, CartItemSchema } from '@schemas/cart_item.schema';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';

@Module({
  controllers: [CartController],
  providers: [CartService],
  imports: [
    ProductsModule,
    OffersModule,
    MongooseModule.forFeature([
      { name: CartItemModel.name, schema: CartItemSchema },
    ]),
  ],
  exports: [CartService],
})
export class CartModule {}
