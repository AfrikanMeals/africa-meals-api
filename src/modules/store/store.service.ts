import { AddressesService } from '@modules/addresses/addresses.service';
import { CartService } from '@modules/cart/cart.service';
import { AddItemToCartDto } from '@modules/cart/dto/cart.dto';
import { MediasService } from '@modules/medias/medias.service';
import { CreateOfferDto } from '@modules/offers/dto/offers.dto';
import { OffersService } from '@modules/offers/offers.service';
import { OrdersService } from '@modules/orders/orders.service';
import {
  CreateProductDto,
  CreateProductExtraDto,
} from '@modules/products/dto/products.dto';
import { ProductsService } from '@modules/products/products.service';
import { CreateRatingDto } from '@modules/ratings/dto/ratings.dto';
import { RatingsService } from '@modules/ratings/ratings.service';
import { SupportedCountriesService } from '@modules/supported-countries/supported-countries.service';
import { UsersService } from '@modules/users/users.service';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AddressTypeEnum } from '@schemas/address.schema';
import { CartItemTypeEnum } from '@schemas/cart_item.schema';
import { AddressModel } from '@schemas/address.schema';
import { StoreModel, StoreStatusEnum } from '@schemas/store.schema';
import { UserModel } from '@schemas/user.schema';
import { Model } from 'mongoose';
import { CreateStoreDto } from './dto/store.dto';

@Injectable()
export class StoreService {
  @InjectModel(StoreModel.name)
  private readonly _storeModel: Model<StoreModel>;

  @Inject(AddressesService)
  private readonly _addressesService: AddressesService;

  @Inject(MediasService)
  private readonly _mediasService: MediasService;

  @Inject(ProductsService)
  private readonly _productsService: ProductsService;

  @Inject(UsersService)
  private readonly _usersService: UsersService;

  @Inject(SupportedCountriesService)
  private readonly _supportedCountries: SupportedCountriesService;

  @Inject(RatingsService)
  private readonly _ratingsService: RatingsService;

  @Inject(OffersService)
  private readonly _offersService: OffersService;

  @Inject(CartService)
  private readonly _cartService: CartService;

  @Inject(OrdersService)
  private readonly _ordersService: OrdersService;

  getStoreModel() {
    return this._storeModel;
  }

  async findOneById(id: string) {
    return this._storeModel
      .findOne({ _id: id })
      .populate('address')
      .populate('owner')
      .populate('ratings')
      .populate('likedBy')
      .exec();
  }

  async create(dto: CreateStoreDto, user: UserModel) {
    const { address, ...args } = dto;
    const fullUser = await this._usersService.findById(
      (user._id as { toString(): string }).toString(),
    );
    await this._supportedCountries.assertVendorApplicationCompatible(
      fullUser,
      dto,
    );
    const exists = await this._storeModel.findOne({ name: args.name }).exec();

    if (exists) {
      throw new ConflictException('store_already_exists');
    }

    const addr = await this._addressesService.create(
      {
        ...address,
        type: AddressTypeEnum.SHOP,
      },
      user,
    );

    if (!addr) {
      throw new ConflictException('address_not_found');
    }

    const hasStore = await this._usersService.hasStore(user);

    if (hasStore) {
      throw new ConflictException('user_has_store');
    }

    const store = await this._storeModel.create({
      ...args,
      address: addr._id,
      owner: user._id,
    });

    if (!store) {
      throw new BadRequestException('could_not_create_store');
    }

    await this._usersService.addStore(store, user);

    await this._storeModel.updateOne(
      { _id: store._id },
      {
        $push: {
          vendorMessages: {
            message:
              'Votre dossier a bien été reçu. Notre équipe examine votre demande. Toute mise à jour apparaîtra ici.',
            from: 'SYSTEM',
            createdAt: new Date(),
          },
        },
      },
    );

    return this.findOneById(store._id.toString());
  }

  /** Résumé boutique pour l’écran vendeur (statut + messages + fiche éditable si PENDING/REVISION). */
  async findMyStoreSummary(user: UserModel) {
    const store = await this._storeModel
      .findOne({ owner: user._id })
      .populate({
        path: 'address',
        select: 'address city country zipCode countryCode location',
      })
      .select(
        'name bio email phoneNumber status vendorMessages acceptsOrders canCreateProducts createdAt supportsShipping shippingZones address',
      )
      .lean()
      .exec();
    if (!store) {
      return { store: null as null };
    }
    const doc = store as Record<string, unknown>;
    const raw = (doc.vendorMessages as Record<string, unknown>[]) ?? [];
    const messages = [...raw].sort(
      (a, b) =>
        new Date(String(b.createdAt)).getTime() -
        new Date(String(a.createdAt)).getTime(),
    );
    const st = doc.status as StoreStatusEnum;
    const canEditApplication = [
      StoreStatusEnum.PENDING,
      StoreStatusEnum.REVISION,
    ].includes(st);

    let application: Record<string, unknown> | null = null;
    if (canEditApplication) {
      const addr = doc.address as AddressModel & {
        location?: { coordinates?: number[] };
      };
      const coords = addr?.location?.coordinates ?? [0, 0];
      const zones = (doc.shippingZones as Record<string, unknown>[]) ?? [];
      application = {
        name: doc.name,
        bio: doc.bio,
        email: doc.email,
        phoneNumber: doc.phoneNumber,
        supportsShipping: !!doc.supportsShipping,
        shippingZones: zones.map((z) => ({
          minDistance: z.minDistance,
          maxDistance: z.maxDistance,
          price: z.price,
        })),
        address: {
          address: addr?.address ?? '',
          city: addr?.city ?? '',
          country: addr?.country ?? '',
          zipCode: addr?.zipCode ?? '',
          countryCode: addr?.countryCode ?? 'CA',
          latitude: coords[1] ?? 0,
          longitude: coords[0] ?? 0,
        },
      };
    }

    return {
      store: {
        id: (doc._id as { toString(): string }).toString(),
        name: doc.name as string,
        status: doc.status as string,
        acceptsOrders: !!doc.acceptsOrders,
        canCreateProducts: !!doc.canCreateProducts,
        createdAt: doc.createdAt,
        canEditApplication,
        application,
        messages: messages.map((m) => ({
          message: String(m.message ?? ''),
          from: String(m.from ?? 'SYSTEM'),
          createdAt: m.createdAt,
        })),
      },
    };
  }

  /** Mise à jour fiche vendeur (dossier en PENDING ou REVISION). */
  async updateVendorApplication(user: UserModel, args: CreateStoreDto) {
    const fullUser = await this._usersService.findById(
      (user._id as { toString(): string }).toString(),
    );
    await this._supportedCountries.assertVendorApplicationCompatible(
      fullUser,
      args,
    );
    const store = await this._storeModel
      .findOne({ owner: user._id })
      .populate('address')
      .exec();
    if (!store) {
      throw new NotFoundException('store_not_found');
    }
    if (
      ![StoreStatusEnum.PENDING, StoreStatusEnum.REVISION].includes(store.status)
    ) {
      throw new ForbiddenException('store_not_editable');
    }
    const dup = await this._storeModel
      .findOne({ name: args.name, _id: { $ne: store._id } })
      .exec();
    if (dup) {
      throw new ConflictException('store_already_exists');
    }
    const addrDoc = store.address as AddressModel & { _id: { toString(): string } };
    const addrId = addrDoc._id.toString();
    await this._addressesService.update(
      addrId,
      {
        ...args.address,
        latitude: args.address.latitude,
        longitude: args.address.longitude,
      },
      user,
    );

    const wasRevision = store.status === StoreStatusEnum.REVISION;
    const shippingZones = args.supportsShipping
      ? args.shippingZones ?? store.shippingZones ?? []
      : [];

    await this._storeModel.updateOne(
      { _id: store._id },
      {
        name: args.name,
        bio: args.bio,
        email: args.email,
        phoneNumber: args.phoneNumber,
        supportsShipping: args.supportsShipping,
        shippingZones,
        ...(wasRevision && { status: StoreStatusEnum.PENDING }),
      },
    );

    await this._storeModel.updateOne(
      { _id: store._id },
      {
        $push: {
          vendorMessages: {
            message: wasRevision
              ? 'Fiche corrigée. Votre dossier est à nouveau en examen.'
              : 'Informations établissement mises à jour.',
            from: 'SYSTEM',
            createdAt: new Date(),
          },
        },
      },
    );

    return this.findMyStoreSummary(user);
  }

  async updateProfileImage(
    id: string,
    file: Express.Multer.File,
    user: UserModel,
  ) {
    let url: string;
    try {
      const store = await this._storeModel
        .findOne({ _id: id, owner: user._id })
        .exec();

      if (!store) {
        throw new BadRequestException('store_not_found');
      }

      url = await this._mediasService.upload(
        file,
        user,
        `stores/${id}/profile`,
      );
      if (!url) {
        throw new BadRequestException('image_upload_failed');
      }

      if (store.profileImage) {
        await this._mediasService.delete(store.profileImage);
      }

      await this._storeModel
        .updateOne({ _id: id }, { profileImage: url })
        .exec();
      return { url };
    } catch (e) {
      console.log('🚀 ~ StoreService ~ updateProfileImage ~ e:', e);
      if (url) {
        await this._mediasService.delete(url);
      }
      throw e;
    }
  }

  async createProduct(
    id: string,
    args: CreateProductDto,
    user: UserModel,
    image?: Express.Multer.File,
  ) {
    const store = await this._storeModel
      .findOne({ _id: id, owner: user._id })
      .populate('address')
      .exec();

    if (!store) {
      throw new NotFoundException('store_not_found');
    }

    if (!store.canCreateProducts) {
      throw new ForbiddenException('can_not_create_products');
    }

    if ((user.paymentMethods || []).length === 0) {
      throw new ForbiddenException('no_payment_methods');
    }

    const exists = await this._productsService.existsInStore(
      args.title,
      store._id.toString(),
    );

    if (exists) {
      throw new ConflictException('product_already_exists');
    }

    const product = await this._productsService.create(
      args,
      user,
      store,
      image,
    );
    return this._productsService.findOneById(product._id.toString());
  }

  async createProducExtra(
    productId: string,
    storeId: string,
    args: CreateProductExtraDto,
    user: UserModel,
  ) {
    const store = await this._storeModel
      .findOne({ _id: storeId, owner: user._id })
      .exec();

    if (!store) {
      throw new NotFoundException('store_not_found');
    }

    if (!store.canCreateProducts) {
      throw new ForbiddenException('can_not_create_products');
    }

    const product = await this._productsService.findOneById(productId);

    if (!product) {
      throw new NotFoundException('product_not_found');
    }

    let url;

    try {
      if (args.image) {
        url = await this._mediasService.upload(
          args.image,
          user,
          `stores/${storeId}/extras/${productId}`,
        );
        if (!url) {
          throw new BadRequestException('image_upload_failed');
        }
        args.profileImage = url;
      }
      const extra = await this._productsService.createExtra(
        args,
        product,
        store,
        user,
      );

      return this._productsService.findOneById(productId);
    } catch (e) {
      if (url) {
        await this._mediasService.delete(url);
      }
      throw e;
    }
  }

  async deleteProductExtra(
    storeId: string,
    productId: string,
    extraId: string,
    user: UserModel,
  ) {
    const product = await this._productsService.findOneById(productId);
    if (!product) {
      throw new NotFoundException('product_not_found');
    }

    if (product.store.id !== storeId) {
      throw new ForbiddenException('unauthorized_action');
    }

    const isValidExtra = product.extras.find(
      (extra) => extra._id.toString() === extraId,
    );
    // console.log('🚀 ~ StoreService ~ isValidExtra:', isValidExtra);
    // console.log('🚀 ~ StoreService ~ product.extras:', product.extras);

    if (!isValidExtra) {
      throw new NotFoundException('extra_not_found');
    }

    const isExtraUsedInOffer =
      await this._offersService.isProductExtraUsedInOffer(
        productId,
        extraId,
        user,
      );

    if (isExtraUsedInOffer) {
      throw new ForbiddenException('extra_used_in_offer');
    }

    await this._productsService.deleteExtra(productId, extraId, user);
    await this._cartService.removeBy({
      type: CartItemTypeEnum.PRODUCT_EXTRA,
      itemId: extraId,
    });
    return this._productsService.findOneById(productId);
  }

  async createRating(id: string, args: CreateRatingDto, user: UserModel) {
    const store = await this._storeModel
      .findOne({ _id: id })
      // .populate('ratings')
      .exec();
    if (!store) {
      throw new NotFoundException('store_not_found');
    }

    try {
      const rating = await this._ratingsService.createStoreRating(
        args,
        store,
        user,
      );

      if (rating) {
        await this._storeModel
          .updateOne(
            { _id: store._id },
            {
              $push: {
                ratings: rating._id,
              },
            },
            {
              new: true,
              upsert: true,
            },
          )
          .exec();
      }
      return this.findOneById(store._id.toString());
    } catch (e) {
      console.log('🚀 ~ StoreService ~ createRating ~ e:', e);
      throw new BadRequestException('error_creating_rating');
    }
  }

  async createOffer(
    id: string,
    args: CreateOfferDto,
    user: UserModel,
  ): Promise<any> {
    const store = await this._storeModel
      .findOne({ _id: id, owner: user._id })
      .exec();
    if (!store) {
      throw new NotFoundException('store_not_found');
    }

    if (!store.canCreateProducts) {
      throw new ForbiddenException('can_not_create_products');
    }

    let url: string;

    try {
      if (args.image) {
        url = await this._mediasService.upload(
          args.image,
          user,
          `stores/${id}/offers`,
        );
        if (!url) {
          throw new BadRequestException('image_upload_failed');
        }
        args.profileImage = url;
      }

      const offer = await this._offersService.create(args, store, user);
      return this._offersService.findOne(offer._id.toString(), user);
    } catch (e) {
      if (url) {
        await this._mediasService.delete(url);
      }
      throw e;
    }
  }

  async addItemToStoreCart(
    id: string,
    args: AddItemToCartDto,
    user: UserModel,
  ) {
    const store = await this._storeModel
      .findOne({ _id: id })
      .populate('owner')
      .exec();

    if (!store) {
      throw new NotFoundException('store_not_found');
    }

    if (store.owner._id.toString() === user.id.toString()) {
      throw new ForbiddenException('cannot_add_item_to_your_store_cart');
    }
    // const item = await this._cartService.itemExistsInCart(store, args, user);
    return await this._cartService.addItemToCart(args, user, store);
  }

  async createOrderFromCart(storeId: string, user: UserModel) {
    const store = await this.findOneById(storeId);

    if (!store) {
      throw new NotFoundException('store_not_found');
    }

    if (!store.acceptsOrders) {
      throw new ForbiddenException('store_does_not_accept_orders');
    }

    const order = await this._ordersService.createFromCart(storeId, user);

    if (order) {
      await this._cartService.clearStoreCart(store, user);
    }

    return order;
  }
}
