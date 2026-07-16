import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { StoreModel } from './store.schema';

/** Type d'élément dans un bundle : produit (plat) ou boisson. */
export enum BundleItemTypeEnum {
  PRODUCT = 'product',
  DRINK = 'drink',
}

/** Type de remise appliquée au bundle. */
export enum BundleDiscountTypeEnum {
  PERCENT = 'percent',
  FIXED = 'fixed',
}

export enum ProductBundleStatusEnum {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

/** Sous-document : un item composant le bundle (produit ou boisson). */
@Schema({ _id: false })
export class BundleItemModel {
  /** Produit ou boisson — détermine quel champ ref est renseigné. */
  @Prop({
    required: true,
    name: 'item_type',
    enum: Object.values(BundleItemTypeEnum),
  })
  itemType: BundleItemTypeEnum;

  /** Réf produit catalogue (si itemType = product). */
  @Prop({
    required: false,
    name: 'product_id',
    type: MongooseSchema.Types.ObjectId,
  })
  productId?: Types.ObjectId;

  /** Réf boisson (si itemType = drink). */
  @Prop({
    required: false,
    name: 'drink_id',
    type: MongooseSchema.Types.ObjectId,
  })
  drinkId?: Types.ObjectId;

  @Prop({ required: false, name: 'sort_order', default: 0 })
  sortOrder: number;

  /** Restriction vendeur : labels de variantes autorisées (vide = toutes). */
  @Prop({ type: [String], default: [], name: 'allowed_variant_labels' })
  allowedVariantLabels: string[];

  /** Restriction vendeur : titres de groupes compléments autorisés (vide = tous). */
  @Prop({
    type: [String],
    default: [],
    name: 'allowed_complement_group_titles',
  })
  allowedComplementGroupTitles: string[];

  /** Restriction vendeur : noms de suppléments autorisés (vide = tous). */
  @Prop({ type: [String], default: [], name: 'allowed_supplement_names' })
  allowedSupplementNames: string[];
}

export const BundleItemSchema =
  SchemaFactory.createForClass(BundleItemModel);

/**
 * Bundle multi-produit (combo) : regroupe plusieurs produits/boissons d'une
 * même boutique avec une remise globale. Le vendeur peut restreindre les
 * variantes/compléments/suppléments disponibles pour chaque item.
 */
@Schema({
  timestamps: true,
  collection: 'product_bundles',
  toJSON: { getters: true, virtuals: true },
})
export class ProductBundleModel {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: StoreModel.name,
    required: true,
    index: true,
  })
  storeId: Types.ObjectId;

  @Prop({ required: true, trim: true, name: 'name_fr' })
  nameFr: string;

  @Prop({ required: true, trim: true, name: 'name_en' })
  nameEn: string;

  @Prop({ required: false, trim: true, name: 'description_fr' })
  descriptionFr?: string;

  @Prop({ required: false, trim: true, name: 'description_en' })
  descriptionEn?: string;

  /** URL image de couverture du bundle. */
  @Prop({ required: false, name: 'image' })
  image?: string;

  /** Items composant le bundle (2+ produits/boissons de la boutique). */
  @Prop({
    type: [BundleItemSchema],
    default: [],
    name: 'items',
    validate: {
      validator: (v: BundleItemModel[]) => v.length >= 2,
      message: 'Un bundle doit contenir au moins 2 items.',
    },
  })
  items: BundleItemModel[];

  /** Type de remise : pourcentage du total ou montant fixe. */
  @Prop({
    required: true,
    name: 'discount_type',
    enum: Object.values(BundleDiscountTypeEnum),
  })
  discountType: BundleDiscountTypeEnum;

  /** Valeur de la remise (ex. 15 pour 15 % ou 5 pour 5 $). */
  @Prop({ required: true, name: 'discount_value', min: 0 })
  discountValue: number;

  @Prop({
    type: String,
    enum: Object.values(ProductBundleStatusEnum),
    default: ProductBundleStatusEnum.ACTIVE,
    index: true,
  })
  status: ProductBundleStatusEnum;

  @Prop({ type: Date, required: false, name: 'valid_from' })
  validFrom?: Date;

  @Prop({ type: Date, required: false, name: 'valid_until' })
  validUntil?: Date;

  @Prop({ required: false, name: 'sort_order', default: 0 })
  sortOrder: number;

  /** Score engagement (clics carrousel + checkouts) pour le tri du feed. */
  @Prop({ type: Number, default: 0, min: 0, name: 'engagement_score' })
  engagementScore: number;
}

export type ProductBundleDocument = HydratedDocument<ProductBundleModel>;

export const ProductBundleSchema =
  SchemaFactory.createForClass(ProductBundleModel);

/** Unicité nom FR par boutique — évite les doublons visuels. */
ProductBundleSchema.index({ storeId: 1, name_fr: 1 }, { unique: true });

/** Feed public : bundles actifs triés par engagement. */
ProductBundleSchema.index({ status: 1, engagement_score: -1 });
