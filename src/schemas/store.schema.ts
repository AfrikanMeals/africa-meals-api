import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { PartnerBadgeCode } from '@common/partner-badges/partner-badge.constants';
import { Schema as MongooseSchema } from 'mongoose';
import { AddressModel } from './address.schema';
import { BaseSchema } from './base.schema';
import type { StoreRatingModel } from './store_rating.schema';
import type { UserModel } from './user.schema';

export enum StoreStatusEnum {
  PENDING = 'PENDING',
  /** L’équipe a demandé des corrections sur la fiche */
  REVISION = 'REVISION',
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

/**
 * Assignation livreurs flotte boutique :
 * - AUTO : hard-assign système au meilleur candidat
 * - SEMI_AUTO : livreurs claim + cascade d’offres
 * - MANUAL : vendeur assigne depuis Commandes
 */
export enum StoreDeliveryAssignmentModeEnum {
  AUTO = 'AUTO',
  SEMI_AUTO = 'SEMI_AUTO',
  MANUAL = 'MANUAL',
}

export enum StoreBusinessTypeEnum {
  RESTAURANT = 'RESTAURANT',
  CONVENIENCE_STORE = 'CONVENIENCE_STORE',
  GROCERY_STORE = 'GROCERY_STORE',
  SPECIALTY_FOOD_STORE = 'SPECIALTY_FOOD_STORE',
  LIQUOR_STORE = 'LIQUOR_STORE',
  FLORIST = 'FLORIST',
  PHARMACY = 'PHARMACY',
}

/** Plats proposés en pré-commande : menu du jour ou catalogue complet. */
export enum MealPreOrderCatalogScopeEnum {
  DAILY_MENU = 'DAILY_MENU',
  CATALOG = 'CATALOG',
}

@Schema({
  toJSON: {
    getters: true,
    virtuals: true,
  },
})
export class StoreShippingZoneModel {
  [x: string]: any;
  @Prop({ required: true, name: 'min_distance' })
  minDistance: number;

  @Prop({ required: true, name: 'max_distance' })
  maxDistance: number;

  @Prop({ required: true, name: 'price' })
  price: number;

  // Computed
  label?: string;
}

@Schema({
  timestamps: true,
  collection: 'stores',
  toJSON: {
    getters: true,
    virtuals: true,
  },
})
export class StoreModel extends BaseSchema {
  @Prop({ required: true, name: 'name' })
  name: string;

  @Prop({ required: true, name: 'bio' })
  bio?: string;

  @Prop({
    required: false,
    name: 'business_type',
    type: String,
  })
  businessType?: string;

  @Prop({ required: true, name: 'email' })
  email: string;

  @Prop({ required: true, name: 'phone_number' })
  phoneNumber: string;

  @Prop({ required: true, name: 'currency', default: 'CAD' })
  currency: string;

  /** Pays ISO enregistré à l’onboarding (taxes, devise) — distinct de l’adresse physique. */
  @Prop({ required: false, name: 'region', type: String })
  region?: string;

  @Prop({ required: false, name: 'profile_image' })
  profileImage?: string;

  @Prop({ default: false, name: 'accepts_orders' }) // TODO should be updated when activating the store
  acceptsOrders?: boolean;

  @Prop({ default: false, name: 'can_create_products' }) // TODO should be updated when activating the store
  canCreateProducts?: boolean;

  @Prop({ default: true, name: 'supports_shipping' })
  supportsShipping?: boolean;

  /**
   * Autorise la pré-commande de repas (commande pour une date/heure ultérieure).
   * Indépendant de la livraison (`supportsShipping`).
   */
  @Prop({ default: false, name: 'accepts_meal_pre_orders' })
  acceptsMealPreOrders?: boolean;

  /**
   * Périmètre catalogue en pré-commande : plats du menu du jour (`DAILY_MENU`)
   * ou tout plat actif du catalogue (`CATALOG`).
   */
  @Prop({
    enum: MealPreOrderCatalogScopeEnum,
    default: MealPreOrderCatalogScopeEnum.DAILY_MENU,
    name: 'meal_pre_order_catalog_scope',
  })
  mealPreOrderCatalogScope?: MealPreOrderCatalogScopeEnum;

  /**
   * Autorise le paiement à la collecte pour les commandes à emporter (pickup).
   * Indépendant de la livraison (`supportsShipping`).
   */
  @Prop({ default: false, name: 'accepts_pickup_pay_on_delivery' })
  acceptsPickupPayOnDelivery?: boolean;

  /**
   * Pré-sélectionne « payer à la collecte » au checkout retrait (si l’option est active).
   */
  @Prop({ default: false, name: 'default_pickup_pay_on_pickup' })
  defaultPickupPayOnPickup?: boolean;

  /**
   * Le restaurant gère sa propre flotte de livreurs (invitations, assignation).
   * Nécessite `supportsShipping`.
   */
  @Prop({ default: false, name: 'vendor_manages_delivery_drivers' })
  vendorManagesDeliveryDrivers?: boolean;

  /** Mode d’assignation lorsque `vendorManagesDeliveryDrivers` est actif (défaut : SEMI_AUTO). */
  @Prop({
    enum: StoreDeliveryAssignmentModeEnum,
    default: StoreDeliveryAssignmentModeEnum.SEMI_AUTO,
    name: 'delivery_assignment_mode',
  })
  deliveryAssignmentMode?: StoreDeliveryAssignmentModeEnum;

  @Prop({
    required: true,
    name: 'status',
    enum: StoreStatusEnum,
    default: StoreStatusEnum.PENDING,
  })
  status: StoreStatusEnum;

  /** Fil de discussion admin ↔ vendeur (statut dossier, demandes, etc.) */
  @Prop({
    type: [
      {
        message: { type: String, required: true },
        from: { type: String, enum: ['ADMIN', 'SYSTEM'], default: 'SYSTEM' },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    default: [],
    name: 'vendor_messages',
  })
  vendorMessages?: { message: string; from: string; createdAt: Date }[];

  @Prop({
    required: true,
    name: 'address',
    ref: AddressModel.name,
    type: MongooseSchema.Types.ObjectId,
  })
  address: AddressModel;

  @Prop({
    required: true,
    name: 'ratings',
    ref: 'StoreRatingModel',
    type: [MongooseSchema.Types.ObjectId],
    select: false,
    default: [],
  })
  ratings: StoreRatingModel[];

  @Prop({
    required: true,
    name: 'owner',
    ref: 'UserModel',
    type: MongooseSchema.Types.ObjectId,
  })
  owner: UserModel;

  @Prop({
    default: [],
    name: 'owner',
    ref: 'UserModel',
    type: [MongooseSchema.Types.ObjectId],
  })
  likedBy: UserModel[];

  /** Compte Stripe Connect (restaurant) — utilisé pour lister les balance transactions côté tableau de bord.
   * Renseigné manuellement ou via votre flux d’onboarding Connect.
   */
  @Prop({ required: false, name: 'stripe_connect_account_id' })
  stripeConnectAccountId?: string;

  /** Push régional « nouveau restaurant » — une seule diffusion par boutique. */
  @Prop({ required: false, name: 'region_launch_notified_at' })
  regionLaunchNotifiedAt?: Date;

  @Prop({
    default: [],
    name: 'shipping_zones',
    type: Array<StoreShippingZoneModel>,
    get: (value: StoreShippingZoneModel[]) => {
      return (value || []).map((item) => {
        return {
          ...item,
          label: `${item.minDistance} - ${item.maxDistance}KM`,
        };
      });
    },
  })
  shippingZones: StoreShippingZoneModel[];

  /**
   * Menu du jour : plats proposés par jour de la semaine (0 = dimanche … 6 = samedi, comme `Date.getDay()`).
   * `productIds` reste toléré en lecture pour les anciennes données ; l’API normalise vers `items`.
   */
  @Prop({
    type: [
      {
        dayOfWeek: { type: Number, required: true, min: 0, max: 6 },
        productIds: [
          { type: MongooseSchema.Types.ObjectId, ref: 'ProductModel' },
        ],
        items: [
          {
            productId: {
              type: MongooseSchema.Types.ObjectId,
              ref: 'ProductModel',
              required: true,
            },
            stockUnlimited: {
              type: Boolean,
              required: true,
              default: true,
            },
            stockRemaining: {
              type: Number,
              required: false,
              min: 0,
              default: 0,
            },
            addonsAvailability: {
              type: {
                variantIndexes: [{ type: Number }],
                complements: [
                  {
                    groupIndex: { type: Number, required: true },
                    optionIndexes: [{ type: Number }],
                  },
                ],
                supplementIndexes: [{ type: Number }],
              },
              required: false,
            },
          },
        ],
        // Boissons proposées ce jour (même logique stock que les plats, sans addons).
        drinkItems: [
          {
            drinkId: {
              type: MongooseSchema.Types.ObjectId,
              ref: 'DrinkModel',
              required: true,
            },
            stockUnlimited: {
              type: Boolean,
              required: true,
              default: true,
            },
            stockRemaining: {
              type: Number,
              required: false,
              min: 0,
              default: 0,
            },
          },
        ],
        // Bundles proposés ce jour (même logique stock, sans addons — le bundle a ses propres items).
        bundleItems: [
          {
            bundleId: {
              type: MongooseSchema.Types.ObjectId,
              ref: 'ProductBundleModel',
              required: true,
            },
            stockUnlimited: {
              type: Boolean,
              required: true,
              default: true,
            },
            stockRemaining: {
              type: Number,
              required: false,
              min: 0,
              default: 0,
            },
          },
        ],
      },
    ],
    default: [],
    name: 'daily_menu_by_weekday',
  })
  dailyMenuByWeekday?: Array<{
    dayOfWeek: number;
    productIds?: unknown[];
    items?: Array<{
      productId: unknown;
      stockUnlimited: boolean;
      stockRemaining: number;
      addonsAvailability?: {
        variantIndexes?: number[];
        complements?: Array<{
          groupIndex: number;
          optionIndexes: number[];
        }>;
        supplementIndexes?: number[];
      };
    }>;
    drinkItems?: Array<{
      drinkId: unknown;
      stockUnlimited: boolean;
      stockRemaining: number;
    }>;
    bundleItems?: Array<{
      bundleId: unknown;
      stockUnlimited: boolean;
      stockRemaining: number;
    }>;
  }>;

  /** Fuseau horaire IANA pour les horaires d’ouverture (ex. Africa/Douala). */
  @Prop({ required: false, name: 'timezone', type: String, trim: true })
  timezone?: string;

  /**
   * Horaires d’ouverture par jour (0 = dimanche … 6 = samedi).
   * Si `enabled` est faux, la boutique est considérée ouverte en permanence.
   */
  @Prop({
    required: false,
    name: 'working_hours',
    type: {
      enabled: { type: Boolean, default: true },
      schedule: [
        {
          dayOfWeek: { type: Number, required: true, min: 0, max: 6 },
          closed: { type: Boolean, default: false },
          open24h: { type: Boolean, default: false },
          slots: [
            {
              open: { type: String, required: true },
              close: { type: String, required: true },
            },
          ],
        },
      ],
    },
  })
  workingHours?: {
    enabled?: boolean;
    schedule?: Array<{
      dayOfWeek: number;
      closed?: boolean;
      open24h?: boolean;
      slots?: Array<{ open: string; close: string }>;
    }>;
  };

  /**
   * URL `src` du locator Google Maps (iframe Quick Builder) collé en admin.
   * Jamais de HTML brut : la fiche web reconstruit l’iframe à partir de cette URL.
   */
  @Prop({
    required: false,
    name: 'locator_embed_src',
    trim: true,
    type: String,
  })
  locatorEmbedSrc?: string;

  /**
   * Config Locator Plus (page HTML Quick Builder) : CONFIGURATION sanitizée.
   * Mutuellement exclusive avec locatorEmbedSrc. Jamais de HTML brut.
   */
  @Prop({
    required: false,
    name: 'locator_embed_config',
    type: MongooseSchema.Types.Mixed,
  })
  locatorEmbedConfig?: Record<string, unknown>;

  /** Badge partenaire (Silver / Gold / Diamond) — délai de versement Stripe. */
  @Prop({
    required: false,
    name: 'partner_badge_code',
    trim: true,
    uppercase: true,
    default: PartnerBadgeCode.SILVER,
  })
  partnerBadgeCode?: string;

  /**
   * Comment la commission plateforme (barème plan / région) est récupérée :
   * - `on_payout` : prix catalogue = prix client ; commission retenue au transfer Connect
   * - `add_to_price` : prix catalogue saisi = net vendeur ; prix client = net + commission
   */
  @Prop({
    required: false,
    name: 'commission_retrieve_strategy',
    enum: ['on_payout', 'add_to_price'],
    default: 'on_payout',
  })
  commissionRetrieveStrategy?: 'on_payout' | 'add_to_price';
}

export const StoreSchema = SchemaFactory.createForClass(StoreModel);

/** Recherche / liste boutiques par statut + tri. */
StoreSchema.index({ status: 1, createdAt: -1 });

/** Filtre / join région ISO (livreur, shipping, taxes). */
StoreSchema.index({ region: 1 });

StoreSchema.virtual('averageRating').get(function () {
  const items = this.ratings || [];
  if (!items.length) {
    return 0;
  }
  return (
    items.reduce((a: number, b: StoreRatingModel) => a + b.rate, 0) /
    items.length
  );
});

export type StoreModelDocument = StoreModel & Document;
