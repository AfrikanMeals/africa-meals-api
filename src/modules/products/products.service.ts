import { MediasService } from '@modules/medias/medias.service';
import { CreateRatingDto } from '@modules/ratings/dto/ratings.dto';
import { RatingsService } from '@modules/ratings/ratings.service';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ProductCategoryModel } from '@schemas/product-category.schema';
import { ProductModel, ProductStatusEnum } from '@schemas/product.schema';
import { StoreModel } from '@schemas/store.schema';
import { UserModel } from '@schemas/user.schema';
import { ObjectId } from 'mongodb';
import { Model } from 'mongoose';
import {
  CreateProductDto,
  CreateProductExtraDto,
  PatchProductDto,
} from './dto/products.dto';

@Injectable()
export class ProductsService {
  @InjectModel(ProductModel.name)
  private readonly _productModel: Model<ProductModel>;

  @InjectModel(ProductCategoryModel.name)
  private readonly _productCategoryModel: Model<ProductCategoryModel>;

  @Inject(MediasService)
  private readonly _mediasService: MediasService;

  @Inject(RatingsService)
  private readonly _ratingsService: RatingsService;

  /** Taille max fichier image avant encodage base64 (5 Mo). */
  private static readonly MAX_IMAGE_BYTES = 5 * 1024 * 1024;

  /** Au plus 2 fichiers en galerie (3 images au total avec la principale). */
  private static readonly MAX_GALLERY_FILES = 2;

  private async uploadGalleryToFirebase(
    files: Express.Multer.File[] | undefined,
    user: UserModel,
    basePath: string,
  ): Promise<{ items: Array<{ imageUrl: string }>; uploadedUrls: string[] }> {
    const uploadedUrls: string[] = [];
    const items: Array<{ imageUrl: string }> = [];
    if (!files?.length) {
      return { items, uploadedUrls };
    }
    for (const f of files.slice(0, ProductsService.MAX_GALLERY_FILES)) {
      const imgBytes = f.buffer?.length ?? f.size ?? 0;
      if (imgBytes > ProductsService.MAX_IMAGE_BYTES) {
        for (const u of uploadedUrls) {
          await this._mediasService.delete(u).catch(() => undefined);
        }
        throw new BadRequestException('image_too_large');
      }
      const url = await this._mediasService.upload(
        f,
        user,
        `${basePath}/gallery`,
      );
      if (!url) {
        for (const u of uploadedUrls) {
          await this._mediasService.delete(u).catch(() => undefined);
        }
        throw new BadRequestException('error_uploading_image');
      }
      uploadedUrls.push(url);
      items.push({ imageUrl: url });
    }
    return { items, uploadedUrls };
  }

  private async deleteRemoteGalleryItems(rawGallery: unknown[]) {
    if (!Array.isArray(rawGallery)) return;
    for (const g of rawGallery) {
      const row = g as Record<string, unknown>;
      const u =
        typeof row.imageUrl === 'string'
          ? row.imageUrl
          : typeof row.image_url === 'string'
            ? row.image_url
            : '';
      if (u.startsWith('http')) {
        await this._mediasService.delete(u).catch(() => undefined);
      }
    }
  }

  getProductModel() {
    return this._productModel;
  }

  getProductCategoryModel() {
    return this._productCategoryModel;
  }

  async findOneById(id: string) {
    return await this._productModel
      .findOne({ _id: id })
      .populate('category')
      .populate({
        path: 'ratings',
        populate: {
          path: 'user',
        },
      })
      .populate('likedBy')
      .populate('store')
      .exec();
  }

  async existsInStore(title: string, storeId: string) {
    return this._productModel
      .findOne({ title, store: { _id: storeId } })
      .exec();
  }

  /** Liste catalogue vendeur (document allégé + catégorie peuplée). */
  async findByStoreId(storeId: string) {
    const rows = await this._productModel
      .find({ store: storeId })
      .populate({ path: 'category', select: 'title' })
      .sort({ updatedAt: -1 })
      .lean()
      .exec();

    return rows.map((p: Record<string, unknown>) => {
      const cat = p.category as Record<string, unknown> | undefined;
      const catId =
        cat?._id != null
          ? String(cat._id)
          : p.category != null
            ? String(p.category)
            : '';
      const catTitle =
        cat && typeof cat.title === 'string' ? cat.title : '';
      const mime =
        typeof p.imageMimeType === 'string'
          ? p.imageMimeType
          : typeof p.image_mime_type === 'string'
            ? p.image_mime_type
            : '';
      const b64 =
        typeof p.imageBase64 === 'string'
          ? p.imageBase64
          : typeof p.image_base64 === 'string'
            ? p.image_base64
            : '';
      const imageFromDb =
        mime && b64 ? `data:${mime};base64,${b64}` : undefined;
      const urlImage =
        typeof p.profileImage === 'string'
          ? p.profileImage
          : typeof p.profile_image === 'string'
            ? p.profile_image
            : undefined;
      const mainSrc = imageFromDb ?? urlImage;
      const rawGallery =
        (p.galleryImages as unknown[]) ??
        (p.gallery_images as unknown[]) ??
        [];
      const galleryUrls: string[] = [];
      if (Array.isArray(rawGallery)) {
        for (const g of rawGallery) {
          const row = g as Record<string, unknown>;
          const gUrl =
            typeof row.imageUrl === 'string'
              ? row.imageUrl
              : typeof row.image_url === 'string'
                ? row.image_url
                : '';
          if (gUrl) {
            galleryUrls.push(gUrl);
            continue;
          }
          const gm =
            typeof row.imageMimeType === 'string'
              ? row.imageMimeType
              : typeof row.image_mime_type === 'string'
                ? row.image_mime_type
                : '';
          const gb =
            typeof row.imageBase64 === 'string'
              ? row.imageBase64
              : typeof row.image_base64 === 'string'
                ? row.image_base64
                : '';
          if (gm && gb) {
            galleryUrls.push(`data:${gm};base64,${gb}`);
          }
        }
      }
      const profileImages = [
        ...(mainSrc ? [mainSrc] : []),
        ...galleryUrls,
      ];
      const galleryHasBase64InDb =
        Array.isArray(rawGallery) &&
        rawGallery.some((g) => {
          const row = g as Record<string, unknown>;
          const gb =
            typeof row.imageBase64 === 'string'
              ? row.imageBase64
              : typeof row.image_base64 === 'string'
                ? row.image_base64
                : '';
          return Boolean(gb);
        });
      return {
        id: String(p._id),
        title: String(p.title ?? ''),
        bio: String(p.bio ?? ''),
        about: String(p.about ?? ''),
        originCountry: String(
          p.originCountry ?? p.origin_country ?? '',
        ),
        price: Number(p.price ?? 0),
        discountPrice: Number(
          p.discountPrice ?? p.discount_price ?? 0,
        ),
        currency: String(p.currency ?? 'CAD'),
        status: String(p.status ?? ProductStatusEnum.PENDING),
        categoryId: catId,
        categoryTitle: catTitle,
        profileImage: mainSrc,
        profileImages,
        imageMimeType: mime || undefined,
        imageStoredInDb: Boolean(b64) || galleryHasBase64InDb,
        createdAt:
          p.createdAt instanceof Date
            ? p.createdAt.toISOString()
            : typeof p.createdAt === 'string'
              ? p.createdAt
              : undefined,
        updatedAt:
          p.updatedAt instanceof Date
            ? p.updatedAt.toISOString()
            : typeof p.updatedAt === 'string'
              ? p.updatedAt
              : undefined,
      };
    });
  }

  async create(
    args: CreateProductDto,
    user: UserModel,
    store: StoreModel,
    image?: Express.Multer.File,
    gallery?: Express.Multer.File[],
  ) {
    const category = await this._productCategoryModel
      .findOne({ _id: args.category })
      .exec();

    if (!category) {
      throw new NotFoundException('category_not_found');
    }

    const storeId = store._id.toString();
    const basePath = `stores/${storeId}/products`;
    const uploadedUrls: string[] = [];
    let profileImage: string | undefined;
    try {
      if (image) {
        const imgBytes = image.buffer?.length ?? image.size ?? 0;
        if (imgBytes > ProductsService.MAX_IMAGE_BYTES) {
          throw new BadRequestException('image_too_large');
        }
        const url = await this._mediasService.upload(image, user, basePath);
        if (!url) {
          throw new BadRequestException('error_uploading_image');
        }
        uploadedUrls.push(url);
        profileImage = url;
      }

      const { items: galleryItems, uploadedUrls: gUrls } =
        await this.uploadGalleryToFirebase(gallery, user, basePath);
      uploadedUrls.push(...gUrls);

      const originCountry = args.originCountry ?? store.address.country;

      const product = await this._productModel.create({
        title: args.title,
        bio: args.bio,
        about: args.about,
        originCountry,
        price: Number(args.price),
        discountPrice:
          args.discountPrice != null ? Number(args.discountPrice) : 0,
        category: category._id,
        store: store._id,
        currency: (args.currency?.trim() || store.currency) as string,
        status: args.status ?? ProductStatusEnum.PENDING,
        ...(profileImage && { profileImage }),
        ...(galleryItems.length > 0 && { galleryImages: galleryItems }),
      });

      return this.findOneById(product._id.toString());
    } catch (e) {
      for (const u of uploadedUrls) {
        await this._mediasService.delete(u).catch(() => undefined);
      }
      throw e;
    }
  }

  async updateForVendor(
    productId: string,
    storeId: string,
    args: PatchProductDto,
    user: UserModel,
    store: StoreModel,
    image?: Express.Multer.File,
    gallery?: Express.Multer.File[],
  ) {
    const doc = await this._productModel
      .findOne({ _id: productId, store: storeId })
      .exec();
    if (!doc) {
      throw new NotFoundException('product_not_found');
    }

    if (args.title != null && args.title.trim() !== doc.title) {
      const dup = await this._productModel
        .findOne({
          title: args.title.trim(),
          store: storeId,
          _id: { $ne: productId },
        })
        .exec();
      if (dup) {
        throw new ConflictException('product_already_exists');
      }
      doc.title = args.title.trim();
    }

    if (args.category != null) {
      const category = await this._productCategoryModel
        .findOne({ _id: args.category })
        .exec();
      if (!category) {
        throw new NotFoundException('category_not_found');
      }
      doc.set('category', category._id);
    }

    if (args.bio != null) {
      doc.bio = args.bio.trim();
    }
    if (args.about !== undefined) {
      doc.about = args.about?.trim() ?? '';
    }
    if (args.originCountry != null) {
      doc.originCountry = args.originCountry.trim();
    }
    if (args.price !== undefined) {
      doc.price = Number(args.price);
    }
    if (args.discountPrice !== undefined) {
      doc.discountPrice = Number(args.discountPrice);
    }
    if (args.currency != null) {
      doc.currency = args.currency.trim();
    }
    if (args.status !== undefined) {
      doc.status = args.status;
    }

    if (image) {
      const imgBytes = image.buffer?.length ?? image.size ?? 0;
      if (imgBytes > ProductsService.MAX_IMAGE_BYTES) {
        throw new BadRequestException('image_too_large');
      }
      if (doc.profileImage?.startsWith('http')) {
        await this._mediasService
          .delete(doc.profileImage)
          .catch(() => undefined);
      }
      doc.set('imageMimeType', undefined);
      doc.set('imageBase64', undefined);
      const url = await this._mediasService.upload(
        image,
        user,
        `stores/${storeId}/products`,
      );
      if (!url) {
        throw new BadRequestException('error_uploading_image');
      }
      doc.set('profileImage', url);
    }

    const rawExistingGallery =
      (doc.galleryImages as unknown[])?.slice() ?? [];
    if (gallery && gallery.length > 0) {
      await this.deleteRemoteGalleryItems(rawExistingGallery);
      const { items } = await this.uploadGalleryToFirebase(
        gallery,
        user,
        `stores/${storeId}/products`,
      );
      doc.set('galleryImages', items);
    } else if (args.clearGallery === true) {
      await this.deleteRemoteGalleryItems(rawExistingGallery);
      doc.set('galleryImages', []);
    }

    await doc.save();
    return this.findOneById(productId);
  }

  async deleteForVendor(productId: string, storeId: string) {
    const doc = await this._productModel
      .findOne({ _id: productId, store: storeId })
      .exec();
    if (!doc) {
      throw new NotFoundException('product_not_found');
    }
    if (doc.profileImage?.startsWith('http')) {
      await this._mediasService.delete(doc.profileImage).catch(() => undefined);
    }
    await this.deleteRemoteGalleryItems(
      (doc.galleryImages as unknown[]) ?? [],
    );
    await doc.deleteOne();
  }

  async createExtra(
    args: CreateProductExtraDto,
    product: ProductModel,
    store: StoreModel,
    user: UserModel,
  ) {
    const exists = await this._productModel
      .findOne({
        _id: product._id,
        store: { _id: store._id },
        extras: {
          $elemMatch: { title: { $regex: new RegExp(`^${args.title}$`, 'i') } },
        },
      })
      .exec();

    if (exists) {
      throw new BadRequestException('product_extra_already_exists');
    }

    await this._productModel
      .updateOne(
        { _id: product._id },
        {
          $push: {
            extras: {
              ...args,
            },
          },
        },
        {
          new: true,
          upsert: true,
        },
      )
      .exec();

    return this.findOneById(product._id.toString());
  }

  async deleteExtra(id: string, extraId: string, user: UserModel) {
    const product = await this._productModel
      .findOne({
        _id: id,
        extras: {
          // _id: extraId,
          // $elemMatch: { title: { $regex: new RegExp(`^${extraId}$`, 'i') } },
          $elemMatch: { _id: new ObjectId(extraId) },
        },
      })
      .populate('store')
      .exec();

    if (!product) {
      throw new NotFoundException('product_extra_not_found');
    }

    if (product.store.owner.toString() !== user._id.toString()) {
      throw new ForbiddenException('not_allowed');
    }

    await this._productModel
      .updateOne(
        { _id: product._id },
        {
          $pull: {
            extras: {
              _id: extraId,
            },
          },
        },
        {
          new: true,
          upsert: true,
        },
      )
      .exec();

    return this.findOneById(id);
  }

  async createRating(id: string, args: CreateRatingDto, user: UserModel) {
    const product = await this._productModel
      .findOne({ _id: id })
      // .populate('ratings')
      .exec();
    if (!product) {
      throw new NotFoundException('product_not_found');
    }

    try {
      const rating = await this._ratingsService.createProductRating(
        args,
        product,
        user,
      );

      if (rating) {
        await this._productModel
          .updateOne(
            { _id: product._id },
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
      return this.findOneById(product._id.toString());
    } catch (e) {
      throw new BadRequestException('error_creating_rating');
    }
  }
}
