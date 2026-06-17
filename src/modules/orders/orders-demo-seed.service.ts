import { isDemoSeedEnvEnabled } from '@common/security/demo-seed.util';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AddressModel, AddressTypeEnum } from '@schemas/address.schema';
import { CartItemTypeEnum } from '@schemas/cart_item.schema';
import { ProductCategoryModel } from '@schemas/product-category.schema';
import { OrderModel, OrderStatusEnum } from '@schemas/order.schema';
import { StoreModel } from '@schemas/store.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';

/** Comptes créés par le seed (idempotent, commandes remplacées à chaque passage). */
const SYNTHETIC_EMAIL_RE = /^afrikan-demo-client-[0-9]+@seed\.local$/;

const LEGACY_SIM_CLIENT = 'simclient@demo.africameals.local';

const TARGET_CLIENT_COUNT = 7;

/** Plats demandés + indices pour choisir une catégorie proche dans `product_categories`. */
const DEMO_DISHES: Array<{
  label: string;
  categoryKeywords: string[];
  unitPrice: number;
  qty: number;
}> = [
  {
    label: 'Jollof rice',
    categoryKeywords: ['Repas', 'riz', 'rice', 'meal'],
    unitPrice: 15.99,
    qty: 1,
  },
  {
    label: 'Poulet braisé + alloco',
    categoryKeywords: ['Fast Food', 'Repas', 'grill', 'poulet'],
    unitPrice: 21.5,
    qty: 1,
  },
  {
    label: 'Attiéké poisson',
    categoryKeywords: ['Repas', 'poisson', 'fish'],
    unitPrice: 18.75,
    qty: 1,
  },
  {
    label: 'Mafé',
    categoryKeywords: ['Repas', 'sauce', 'mafé'],
    unitPrice: 17.25,
    qty: 1,
  },
  {
    label: 'Ndolé',
    categoryKeywords: ['Repas', 'ndolé', 'cameroun'],
    unitPrice: 19.99,
    qty: 1,
  },
  {
    label: 'Garba',
    categoryKeywords: ['Fast Food', 'Repas', 'street'],
    unitPrice: 12.0,
    qty: 2,
  },
  {
    label: 'Puff-puff',
    categoryKeywords: ['Fruits', 'desert', 'dessert', 'snack', 'Fast Food'],
    unitPrice: 6.5,
    qty: 3,
  },
];

/** Un statut par commande (7 commandes = 7 plats). */
const ORDER_STATUSES: Array<{
  status: OrderStatusEnum;
  shippingPrice: number;
}> = [
  { status: OrderStatusEnum.CREATED, shippingPrice: 0 },
  { status: OrderStatusEnum.PAIED, shippingPrice: 0 },
  { status: OrderStatusEnum.APPROVED, shippingPrice: 0 },
  { status: OrderStatusEnum.CANCELLED, shippingPrice: 0 },
  { status: OrderStatusEnum.SHIPPED, shippingPrice: 5.99 },
  { status: OrderStatusEnum.COMPLETED, shippingPrice: 4.5 },
  { status: OrderStatusEnum.PAIED, shippingPrice: 0 },
];

const SYNTHETIC_NAMES = [
  'Aminata Koné',
  'Ibrahim Sow',
  'Fatou Diallo',
  'Kwame Mensah',
  'Ndeye Sarr',
  'Jean-Baptiste Ouedraogo',
  'Habiba Benali',
];

/** Adresses au Saguenay–Lac-Saint-Jean pour les nouveaux clients sans adresse. */
const SAGUENAY_DEMO_ADDRESSES: Array<{
  label: string;
  address: string;
  city: string;
  zipCode: string;
  isDefault: boolean;
  coordinates: [number, number];
}> = [
  {
    label: 'Domicile',
    address: '180 rue Racine E',
    city: 'Chicoutimi',
    zipCode: 'G7H 1R2',
    isDefault: true,
    coordinates: [-71.055_082, 48.428_082],
  },
  {
    label: 'Domicile',
    address: '2450 boul. Talbot',
    city: 'Chicoutimi',
    zipCode: 'G7H 4E4',
    isDefault: true,
    coordinates: [-71.092_104, 48.417_501],
  },
  {
    label: 'Domicile',
    address: '3900 boul. Harvey',
    city: 'Jonquière',
    zipCode: 'G7X 7X2',
    isDefault: true,
    coordinates: [-71.151_2, 48.416_5],
  },
];

/**
 * Commandes de démonstration : clients issus de la BD (type USER) complétés par
 * des comptes `@seed.local`, plats réalistes + `category_title` aligné sur les
 * catégories catalogue en base.
 *
 * Désactivé par défaut au démarrage. Activer explicitement : `SEED_DEMO_ORDERS=true`.
 *
 * Supprime les anciennes commandes de démo pour cette boutique (clients synthétiques,
 * ancien client Sim, libellés `Sim —` / `Démo AE`) puis recrée 7 commandes.
 */
@Injectable()
export class OrdersDemoSeedService implements OnModuleInit {
  private readonly logger = new Logger(OrdersDemoSeedService.name);

  @InjectModel(OrderModel.name)
  private readonly orderModel: Model<OrderModel>;

  @InjectModel(StoreModel.name)
  private readonly storeModel: Model<StoreModel>;

  @InjectModel(UserModel.name)
  private readonly userModel: Model<UserModel>;

  @InjectModel(AddressModel.name)
  private readonly addressModel: Model<AddressModel>;

  @InjectModel(ProductCategoryModel.name)
  private readonly categoryModel: Model<ProductCategoryModel>;

  async onModuleInit() {
    await this.seedDemoOrdersIfNeeded();
  }

  private async seedDemoOrdersIfNeeded() {
    if (!isDemoSeedEnvEnabled('SEED_DEMO_ORDERS')) {
      return;
    }

    const stores = await this.storeModel.find().sort({ _id: 1 }).exec();
    if (!stores.length) {
      this.logger.warn(
        'Commandes démo : aucune boutique en base — aucune insertion.',
      );
      return;
    }

    const categories = await this.categoryModel
      .find({ isEnabled: { $ne: false } })
      .sort({ title: 1 })
      .exec();

    if (!categories.length) {
      this.logger.warn(
        'Commandes démo : aucune catégorie produit — créez-en au moins une (seed catalogue).',
      );
    }

    const clientPool = await this.buildClientPool(TARGET_CLIENT_COUNT);
    const poolIds = clientPool.map((u) => u._id);

    for (let i = 0; i < clientPool.length; i++) {
      await this.ensureUserHasSaguenayAddressIfEmpty(clientPool[i]!._id, i);
    }

    let totalInserted = 0;

    for (const store of stores) {
      await this.removePreviousDemoOrdersForStore(store._id, poolIds);

      for (let i = 0; i < DEMO_DISHES.length; i++) {
        const dish = DEMO_DISHES[i]!;
        const st =
          ORDER_STATUSES[i] ?? ORDER_STATUSES[ORDER_STATUSES.length - 1]!;
        const client = clientPool[i % clientPool.length]!;
        const categoryTitle = this.pickCategoryTitle(
          dish.categoryKeywords,
          categories,
        );

        const linesTotal = roundCad(dish.unitPrice * dish.qty);
        const totalPrice = roundCad(linesTotal + st.shippingPrice);

        await this.orderModel.create({
          store: store._id,
          user: client._id,
          status: st.status,
          totalPrice,
          shippingPrice: st.shippingPrice,
          shouldShip: st.shippingPrice > 0,
          items: [
            {
              label: dish.label,
              itemType: CartItemTypeEnum.PRODUCT,
              price: dish.unitPrice,
              quantity: dish.qty,
              categoryTitle,
            },
          ],
        });
        totalInserted += 1;
      }
    }

    this.logger.log(
      `Commandes démo : ${totalInserted} commande(s) (${DEMO_DISHES.length} plats × ${stores.length} boutique(s)), ` +
        `${clientPool.length} client(s) (BD + complément seed.local).`,
    );
  }

  /** Utilisateurs type USER existants, complétés par des comptes stables `afrikan-demo-client-*@seed.local`. */
  private async buildClientPool(count: number): Promise<UserModel[]> {
    const fromDb = await this.userModel
      .find({ type: UserTypeEnum.USER })
      .sort({ updatedAt: -1 })
      .limit(count)
      .exec();

    const pool: UserModel[] = [...fromDb];
    let synthIdx = 0;

    while (pool.length < count) {
      const email = `afrikan-demo-client-${synthIdx}@seed.local`;
      let u = await this.userModel.findOne({ email }).exec();
      if (!u) {
        u = await this.userModel.create({
          type: UserTypeEnum.USER,
          fullName:
            SYNTHETIC_NAMES[synthIdx % SYNTHETIC_NAMES.length] ??
            `Client démo ${synthIdx + 1}`,
          email,
          phoneNumber: `+1418555${String(3100 + synthIdx).padStart(4, '0')}`,
          password: 'AfrikanDemoClient123!',
          appCountryCode: 'CA',
        });
      }
      pool.push(u);
      synthIdx += 1;
    }

    return pool.slice(0, count);
  }

  private pickCategoryTitle(
    keywords: string[],
    categories: ProductCategoryModel[],
  ): string {
    if (!categories.length) {
      return keywords[0] ?? 'Repas';
    }
    const lower = (s: string) => s.toLowerCase().normalize('NFD');
    for (const kw of keywords) {
      const k = lower(kw);
      const hit = categories.find(
        (c) =>
          lower(c.title).includes(k) ||
          k.includes(lower(c.title)) ||
          lower(c.title).replace(/\s/g, '') === k.replace(/\s/g, ''),
      );
      if (hit) {
        return hit.title;
      }
    }
    const repas = categories.find((c) => /repas|plat|meal/i.test(c.title));
    return repas?.title ?? categories[0]!.title;
  }

  private async removePreviousDemoOrdersForStore(
    storeId: unknown,
    poolIds: unknown[],
  ) {
    const syntheticUsers = await this.userModel
      .find({ email: { $regex: SYNTHETIC_EMAIL_RE } })
      .select('_id')
      .exec();
    const legacySim = await this.userModel
      .findOne({ email: LEGACY_SIM_CLIENT })
      .select('_id')
      .exec();

    const userIds = syntheticUsers.map((u) => u._id);
    if (legacySim) {
      userIds.push(legacySim._id);
    }

    const orClause: Record<string, unknown>[] = [
      { 'items.label': { $regex: /^Sim —/ } },
      { 'items.label': { $regex: /^Démo AE/ } },
    ];
    if (userIds.length) {
      orClause.push({ user: { $in: userIds } });
    }

    let deleted = 0;
    const res = await this.orderModel
      .deleteMany({
        store: storeId,
        $or: orClause,
      })
      .exec();
    deleted += res.deletedCount ?? 0;

    /** Évite les doublons au redémarrage : commandes 1 ligne = un plat démo pour le pool courant. */
    const dishLabels = DEMO_DISHES.map((d) => d.label);
    if (poolIds.length) {
      const resPool = await this.orderModel
        .deleteMany({
          store: storeId,
          user: { $in: poolIds },
          items: { $size: 1 },
          'items.0.label': { $in: dishLabels },
        })
        .exec();
      deleted += resPool.deletedCount ?? 0;
    }

    if (deleted > 0) {
      this.logger.log(
        `Commandes démo : ${deleted} ancienne(s) commande(s) retirée(s) pour la boutique ${String(
          storeId,
        )}.`,
      );
    }
  }

  private async ensureUserHasSaguenayAddressIfEmpty(
    userId: unknown,
    index: number,
  ) {
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      return;
    }
    if (user.addresses && user.addresses.length > 0) {
      return;
    }

    const tpl =
      SAGUENAY_DEMO_ADDRESSES[index % SAGUENAY_DEMO_ADDRESSES.length]!;

    const doc = await this.addressModel.create({
      isDefault: tpl.isDefault,
      label: tpl.label,
      address: tpl.address,
      country: 'Canada',
      city: tpl.city,
      countryCode: 'CA',
      zipCode: tpl.zipCode,
      type: AddressTypeEnum.USER,
      location: {
        type: 'Point' as const,
        coordinates: tpl.coordinates,
      },
    });

    await this.userModel
      .updateOne({ _id: user._id }, { $set: { addresses: [doc._id] } })
      .exec();
  }
}

function roundCad(n: number): number {
  return Math.round(n * 100) / 100;
}
