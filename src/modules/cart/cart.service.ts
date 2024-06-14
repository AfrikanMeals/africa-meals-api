import { OffersService } from '@modules/offers/offers.service';
import { ProductsService } from '@modules/products/products.service';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { CartItemModel, CartItemTypeEnum } from '@schemas/cart_item.schema';
import { UserModel } from '@schemas/user.schema';
import { ObjectId } from 'mongodb';
import { Model } from 'mongoose';
import { AddItemToCartDto, RemoveItemFromCartDto } from './dto/cart.dto';

@Injectable()
export class CartService {
  @InjectModel(CartItemModel.name)
  private readonly _cartItemModel: Model<CartItemModel>;

  @Inject(ProductsService)
  private readonly _productsService: ProductsService;

  @Inject(OffersService)
  private readonly _offersService: OffersService;

  async findOneById(id: string, user: UserModel) {
    const item = await this._cartItemModel
      .findOne({ _id: new ObjectId(id) })
      .exec();
    if (!item) {
      throw new NotFoundException('cart_item_not_found');
    }

    if (item.type === CartItemTypeEnum.OFFER) {
      const offer = await this._offersService.findOne(item.entityId, user);
      if (!offer) {
        throw new NotFoundException('offer_not_found');
      }
      return {
        ...item.toJSON(),
        entity: offer,
      };
    } else if (item.type === CartItemTypeEnum.PRODUCT) {
      const product = await this._productsService.findOneById(item.entityId);
      if (!product) {
        throw new NotFoundException('product_not_found');
      }
      return {
        ...item.toJSON(),
        entity: product,
      };
    } else {
      const product = await this._productsService.findOneById(item.productId);
      if (!product) {
        throw new NotFoundException('product_not_found');
      }

      const extra = product.extras.find((e) => e.id === item.entityId);
      if (!extra) {
        throw new NotFoundException('extra_not_found');
      }
      return {
        ...item.toJSON(),
        entity: extra,
      };
    }
  }

  async filter(user: UserModel) {
    const items = await this._cartItemModel
      .find({ user: new ObjectId(user.id) })
      .populate({
        path: 'user',
      })
      .exec();

    return {
      items: await Promise.all(
        (items ?? []).map((item) =>
          this.findOneById(item._id.toString(), user),
        ),
      ),
    };
  }

  async addItemToCart(args: AddItemToCartDto, user: UserModel) {
    let item = await this._cartItemModel
      .findOne({
        entityId: args.itemId,
        type: args.type,
        user: new ObjectId(user.id),
      })
      .exec();
    if (item) {
      await this._cartItemModel
        .updateOne({ _id: item.id }, { $inc: { quantity: 1 } })
        .exec();
      // return await this.findOneById(item._id.toString(), user);
    } else {
      item = await this._cartItemModel.create({
        user: new ObjectId(user.id),
        entityId: args.itemId,
        ...(args.type === CartItemTypeEnum.PRODUCT_EXTRA && {
          productId: args.productId,
        }),
        type: args.type,
        quantity: 1,
        price: args.price,
      });
    }

    return await this.findOneById(item._id.toString(), user);
  }

  async removeBy(args: RemoveItemFromCartDto) {
    return await this._cartItemModel
      .deleteOne({ entityId: args.itemId, type: args.type })
      .exec();
  }

  async removeById(id: string, user: UserModel) {
    return await this._cartItemModel
      .deleteOne({ _id: new ObjectId(id), user: new ObjectId(user.id) })
      .exec();
  }
}
