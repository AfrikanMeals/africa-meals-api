import {
  isStripeConnectOnboardingCompleteUser,
  resolveStoreIdsVisibleOnMobileApp,
} from '@modules/billing/stripe/stripe-connect-visibility';
import { MediasService } from '@modules/medias/medias.service';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { DrinkModel, DrinkStatutEnum } from '@schemas/drink.schema';
import { StoreModel, StoreStatusEnum } from '@schemas/store.schema';
import { UserModel } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import { CreateDrinkDto, PatchDrinkDto } from './dto/drink.dto';

function computeStatut(quantite: number, seuil: number): DrinkStatutEnum {
  return quantite <= seuil ? DrinkStatutEnum.ALERTE : DrinkStatutEnum.OK;
}

/** Filtre catalogue client mobile : boissons encore en stock. */
export const DRINK_IN_STOCK_FILTER = { quantite: { $gt: 0 } } as const;

/** Quantité max commandable pour une boisson = stock `quantite` (le seuil sert uniquement à l’alerte stock). */
export function maxDrinkOrderQuantity(quantite: number): number {
  return Math.max(0, Math.floor(Number(quantite)));
}

/** Liste catalogue vendeur mobile (champs affichés uniquement). */
function mapDrinkCatalogListRow(doc: Record<string, unknown>) {
  const img =
    doc.imageUrl != null
      ? String(doc.imageUrl)
      : doc.image_url != null
      ? String(doc.image_url)
      : '';
  const imageUrl =
    img.startsWith('http://') || img.startsWith('https://') ? img : undefined;
  return {
    id: String(doc._id),
    name: String(doc.name ?? ''),
    description: doc.description != null ? String(doc.description) : '',
    priceCad: Number(doc.priceCad ?? doc.price_cad ?? 0),
    quantite: Number(doc.quantite ?? 0),
    seuil: Number(doc.seuil ?? 0),
    statut: String(doc.statut ?? DrinkStatutEnum.OK),
    ...(imageUrl ? { imageUrl } : {}),
  };
}

function mapDrinkDoc(doc: Record<string, unknown>) {
  const created = doc.createdAt;
  const updated = doc.updatedAt;
  return {
    id: String(doc._id),
    name: String(doc.name ?? ''),
    description: doc.description != null ? String(doc.description) : '',
    quantite: Number(doc.quantite ?? 0),
    seuil: Number(doc.seuil ?? 0),
    priceCad: Number(doc.priceCad ?? doc.price_cad ?? 0),
    statut: String(doc.statut ?? DrinkStatutEnum.OK) as DrinkStatutEnum,
    imageUrl:
      doc.imageUrl != null
        ? String(doc.imageUrl)
        : doc.image_url != null
        ? String(doc.image_url)
        : undefined,
    createdAt:
      created instanceof Date
        ? created.toISOString()
        : typeof created === 'string'
        ? created
        : undefined,
    updatedAt:
      updated instanceof Date
        ? updated.toISOString()
        : typeof updated === 'string'
        ? updated
        : undefined,
  };
}

@Injectable()
export class DrinksService {
  private _escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  @InjectModel(DrinkModel.name)
  private readonly _drinkModel: Model<DrinkModel>;

  @InjectModel(StoreModel.name)
  private readonly _storeModel: Model<StoreModel>;

  @InjectModel(UserModel.name)
  private readonly _userModel: Model<UserModel>;

  @Inject(MediasService)
  private readonly _mediasService: MediasService;

  private async isStoreVisibleOnMobileApp(storeId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(storeId)) {
      return false;
    }
    const store = await this._storeModel
      .findById(storeId)
      .select('status owner')
      .lean()
      .exec();
    if (!store || store.status !== StoreStatusEnum.ACTIVE) {
      return false;
    }
    const owner = await this._userModel
      .findById(store.owner)
      .select(
        'stripeConnectAccountId stripeConnectChargesEnabled stripeConnectPayoutsEnabled stripeConnectDetailsSubmitted stripeConnectDisabledReason stripeConnectRequirementsDue stripeConnectRequirementsPastDue',
      )
      .lean()
      .exec();
    return isStripeConnectOnboardingCompleteUser(owner);
  }

  private async assertStoreOwner(storeId: string, user: UserModel) {
    const store = await this._storeModel
      .findOne({ _id: storeId, owner: user._id })
      .select('_id')
      .exec();
    if (!store) {
      throw new NotFoundException('store_not_found');
    }
  }

  /** Détail boisson — propriétaire boutique. */
  async findOneForStoreOwner(
    storeId: string,
    drinkId: string,
    user: UserModel,
  ) {
    await this.assertStoreOwner(storeId, user);
    if (!Types.ObjectId.isValid(storeId) || !Types.ObjectId.isValid(drinkId)) {
      throw new NotFoundException('drink_not_found');
    }
    const row = await this._drinkModel
      .findOne({
        _id: new Types.ObjectId(drinkId),
        store: new Types.ObjectId(storeId),
      })
      .lean()
      .exec();
    if (!row) {
      throw new NotFoundException('drink_not_found');
    }
    return mapDrinkDoc(row as Record<string, unknown>);
  }

  async findByStoreForOwner(storeId: string, user: UserModel) {
    await this.assertStoreOwner(storeId, user);
    if (!Types.ObjectId.isValid(storeId)) {
      return [];
    }
    const rows = await this._drinkModel
      .find({ store: new Types.ObjectId(storeId) })
      .sort({ updatedAt: -1 })
      .lean()
      .exec();
    return rows.map((r) => mapDrinkDoc(r as Record<string, unknown>));
  }

  /** Catalogue boissons vendeur (pagination + recherche, payload minimal). */
  async findByStoreForOwnerPaginated(
    storeId: string,
    user: UserModel,
    opts: { page: number; take: number; q?: string },
  ) {
    await this.assertStoreOwner(storeId, user);
    if (!Types.ObjectId.isValid(storeId)) {
      return { items: [], total: 0, page: 1, limit: opts.take };
    }
    const storeOid = new Types.ObjectId(storeId);
    const match: Record<string, unknown> = { store: storeOid };
    const q = opts.q?.trim();
    if (q) {
      const esc = this._escapeRegex(q);
      match.$or = [
        { name: { $regex: esc, $options: 'i' } },
        { description: { $regex: esc, $options: 'i' } },
      ];
    }
    const page = Math.max(1, opts.page);
    const take = Math.min(80, Math.max(8, opts.take));
    const skip = (page - 1) * take;

    const agg = await this._drinkModel
      .aggregate([
        { $match: match },
        {
          $facet: {
            total: [{ $count: 'n' }],
            rows: [
              { $sort: { updatedAt: -1 } },
              { $skip: skip },
              { $limit: take },
              {
                $project: {
                  name: 1,
                  description: 1,
                  quantite: 1,
                  seuil: 1,
                  statut: 1,
                  price_cad: 1,
                  priceCad: 1,
                  image_url: 1,
                  imageUrl: 1,
                },
              },
            ],
          },
        },
      ])
      .exec();

    const bucket = agg[0] as
      | { total?: { n?: number }[]; rows?: Record<string, unknown>[] }
      | undefined;
    const total = bucket?.total?.[0]?.n ?? 0;
    const rows = bucket?.rows ?? [];

    return {
      items: rows.map((r) => mapDrinkCatalogListRow(r)),
      total,
      page,
      limit: take,
    };
  }

  /**
   * Liste catalogue client (sans JWT) : boutique existante + boissons encore en stock.
   * @param searchQuery — optionnel : filtre insensible à la casse sur `name` / `description` (regex échappée).
   */
  async findByStoreForCatalog(storeId: string, searchQuery?: string) {
    if (!Types.ObjectId.isValid(storeId)) {
      return [];
    }
    if (!(await this.isStoreVisibleOnMobileApp(storeId))) {
      return [];
    }
    const baseFilter: Record<string, unknown> = {
      store: new Types.ObjectId(storeId),
      ...DRINK_IN_STOCK_FILTER,
    };
    const q = searchQuery?.trim();
    if (q) {
      const esc = this._escapeRegex(q);
      baseFilter['$or'] = [
        { name: { $regex: esc, $options: 'i' } },
        { description: { $regex: esc, $options: 'i' } },
      ];
    }
    let query = this._drinkModel
      .find(baseFilter)
      .sort({ updatedAt: -1 })
      .lean();
    if (q) {
      query = query.limit(80);
    }
    const rows = await query.exec();
    return rows.map((r) => mapDrinkDoc(r as Record<string, unknown>));
  }

  /**
   * Une boisson du catalogue client (boutique + stock > 0), ou `null`.
   */
  async findOneInStoreCatalog(
    storeId: string,
    drinkId: string,
  ): Promise<ReturnType<typeof mapDrinkDoc> | null> {
    if (!Types.ObjectId.isValid(storeId) || !Types.ObjectId.isValid(drinkId)) {
      return null;
    }
    const row = await this._drinkModel
      .findOne({
        _id: new Types.ObjectId(drinkId),
        store: new Types.ObjectId(storeId),
        ...DRINK_IN_STOCK_FILTER,
      })
      .lean()
      .exec();
    if (!row) {
      return null;
    }
    return mapDrinkDoc(row as Record<string, unknown>);
  }

  /**
   * Boissons en stock pour plusieurs boutiques (recommandations accueil, etc.).
   */
  async findByStoresForCatalog(
    storeIds: string[],
    maxItems: number,
  ): Promise<Array<ReturnType<typeof mapDrinkDoc> & { storeId: string }>> {
    const candidateOids = storeIds
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    if (!candidateOids.length) return [];
    const visible = await resolveStoreIdsVisibleOnMobileApp(
      this._storeModel,
      candidateOids,
    );
    const oids = candidateOids.filter((id) => visible.has(id.toString()));
    if (!oids.length) return [];
    const limit = Math.min(120, Math.max(1, Math.floor(maxItems)));
    const rows = await this._drinkModel
      .find({
        store: { $in: oids },
        ...DRINK_IN_STOCK_FILTER,
      })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean()
      .exec();
    return rows.map((r) => {
      const raw = r as unknown as Record<string, unknown>;
      const storeRef = raw['store'];
      const storeId =
        storeRef != null &&
        typeof storeRef === 'object' &&
        'toString' in storeRef
          ? String(storeRef)
          : storeRef != null
          ? String(storeRef)
          : '';
      return {
        ...mapDrinkDoc(raw),
        storeId,
      };
    });
  }

  /** Validation panier : boisson de la boutique même si stock à 0. */
  async findOneInStoreByIdRaw(
    storeId: string,
    drinkId: string,
  ): Promise<ReturnType<typeof mapDrinkDoc> | null> {
    if (!Types.ObjectId.isValid(storeId) || !Types.ObjectId.isValid(drinkId)) {
      return null;
    }
    const row = await this._drinkModel
      .findOne({
        _id: new Types.ObjectId(drinkId),
        store: new Types.ObjectId(storeId),
      })
      .lean()
      .exec();
    if (!row) {
      return null;
    }
    return mapDrinkDoc(row as Record<string, unknown>);
  }

  async createForStore(
    storeId: string,
    dto: CreateDrinkDto,
    user: UserModel,
    file?: Express.Multer.File,
  ) {
    await this.assertStoreOwner(storeId, user);
    const quantite = Number(dto.quantite);
    const seuil = Number(dto.seuil);
    const priceCad = Number(dto.priceCad);
    const statut = computeStatut(quantite, seuil);
    let imageUrl: string | undefined;
    if (file?.buffer?.length) {
      imageUrl = await this._mediasService.upload(
        file,
        user,
        `stores/${storeId}/drinks`,
      );
    }
    const doc = await this._drinkModel.create({
      name: dto.name.trim(),
      description: dto.description?.trim() || undefined,
      quantite,
      seuil,
      priceCad,
      statut,
      store: new Types.ObjectId(storeId),
      ...(imageUrl ? { imageUrl } : {}),
    });
    return mapDrinkDoc(doc.toObject() as Record<string, unknown>);
  }

  async updateForStore(
    storeId: string,
    drinkId: string,
    dto: PatchDrinkDto,
    user: UserModel,
    file?: Express.Multer.File,
  ) {
    await this.assertStoreOwner(storeId, user);
    if (!Types.ObjectId.isValid(drinkId)) {
      throw new NotFoundException('drink_not_found');
    }
    const found = await this._drinkModel
      .findOne({
        _id: new Types.ObjectId(drinkId),
        store: new Types.ObjectId(storeId),
      })
      .exec();
    if (!found) {
      throw new NotFoundException('drink_not_found');
    }
    const quantite =
      dto.quantite !== undefined ? Number(dto.quantite) : found.quantite;
    const seuil = dto.seuil !== undefined ? Number(dto.seuil) : found.seuil;
    const priceCad =
      dto.priceCad !== undefined ? Number(dto.priceCad) : found.priceCad;
    const name = dto.name != null ? dto.name.trim() : found.name;
    const description =
      dto.description !== undefined
        ? dto.description.trim() || undefined
        : found.description;
    const statut = computeStatut(quantite, seuil);
    found.name = name;
    found.description = description;
    found.quantite = quantite;
    found.seuil = seuil;
    found.priceCad = priceCad;
    found.statut = statut;

    if (file?.buffer?.length) {
      const url = await this._mediasService.upload(
        file,
        user,
        `stores/${storeId}/drinks`,
      );
      if (found.imageUrl) {
        await this._mediasService.delete(found.imageUrl).catch(() => undefined);
      }
      found.imageUrl = url;
    } else if (dto.clearImage === true) {
      if (found.imageUrl) {
        await this._mediasService.delete(found.imageUrl).catch(() => undefined);
      }
      found.imageUrl = undefined;
    }

    await found.save();
    return mapDrinkDoc(found.toObject() as Record<string, unknown>);
  }

  async deleteForStore(storeId: string, drinkId: string, user: UserModel) {
    await this.assertStoreOwner(storeId, user);
    if (!Types.ObjectId.isValid(drinkId)) {
      throw new NotFoundException('drink_not_found');
    }
    const doc = await this._drinkModel
      .findOne({
        _id: new Types.ObjectId(drinkId),
        store: new Types.ObjectId(storeId),
      })
      .exec();
    if (!doc) {
      throw new NotFoundException('drink_not_found');
    }
    if (doc.imageUrl) {
      await this._mediasService.delete(doc.imageUrl).catch(() => undefined);
    }
    await doc.deleteOne();
  }

  /**
   * Décrémente le stock boisson de façon atomique (commande payée / panier → commande).
   * Met à jour `statut` selon `quantite` vs `seuil`.
   */
  async tryConsumeStock(
    storeId: string,
    drinkId: string,
    qty: number,
  ): Promise<boolean> {
    const q = Math.floor(Number(qty));
    if (
      !Types.ObjectId.isValid(storeId) ||
      !Types.ObjectId.isValid(drinkId) ||
      q <= 0
    ) {
      return false;
    }
    const res = await this._drinkModel
      .updateOne(
        {
          _id: new Types.ObjectId(drinkId),
          store: new Types.ObjectId(storeId),
          quantite: { $gte: q },
        },
        { $inc: { quantite: -q } },
      )
      .exec();
    if (res.modifiedCount !== 1) {
      return false;
    }
    await this.syncStatutAfterQuantiteChange(new Types.ObjectId(drinkId));
    return true;
  }

  /** Annule une consommation (ex. échec après décrément, rollback commande). */
  async restoreStock(
    storeId: string,
    drinkId: string,
    qty: number,
  ): Promise<void> {
    const q = Math.floor(Number(qty));
    if (
      !Types.ObjectId.isValid(storeId) ||
      !Types.ObjectId.isValid(drinkId) ||
      q <= 0
    ) {
      return;
    }
    await this._drinkModel
      .updateOne(
        {
          _id: new Types.ObjectId(drinkId),
          store: new Types.ObjectId(storeId),
        },
        { $inc: { quantite: q } },
      )
      .exec();
    await this.syncStatutAfterQuantiteChange(new Types.ObjectId(drinkId));
  }

  private async syncStatutAfterQuantiteChange(drinkOid: Types.ObjectId) {
    await this._drinkModel
      .updateOne({ _id: drinkOid }, [
        {
          $set: {
            statut: {
              $cond: [
                { $lte: ['$quantite', '$seuil'] },
                DrinkStatutEnum.ALERTE,
                DrinkStatutEnum.OK,
              ],
            },
          },
        },
      ])
      .exec();
  }
}
