import { MediasService } from '@modules/medias/medias.service';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { DrinkModel, DrinkStatutEnum } from '@schemas/drink.schema';
import { StoreModel } from '@schemas/store.schema';
import { UserModel } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import { CreateDrinkDto, PatchDrinkDto } from './dto/drink.dto';

function computeStatut(quantite: number, seuil: number): DrinkStatutEnum {
  return quantite <= seuil ? DrinkStatutEnum.ALERTE : DrinkStatutEnum.OK;
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

  @Inject(MediasService)
  private readonly _mediasService: MediasService;

  private async assertStoreOwner(storeId: string, user: UserModel) {
    const store = await this._storeModel
      .findOne({ _id: storeId, owner: user._id })
      .select('_id')
      .exec();
    if (!store) {
      throw new NotFoundException('store_not_found');
    }
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

  /**
   * Liste catalogue client (sans JWT) : boutique existante + boissons encore en stock.
   * @param searchQuery — optionnel : filtre insensible à la casse sur `name` / `description` (regex échappée).
   */
  async findByStoreForCatalog(storeId: string, searchQuery?: string) {
    if (!Types.ObjectId.isValid(storeId)) {
      return [];
    }
    const store = await this._storeModel
      .findById(storeId)
      .select('_id')
      .lean()
      .exec();
    if (store == null) {
      return [];
    }
    const baseFilter: Record<string, unknown> = {
      store: new Types.ObjectId(storeId),
      quantite: { $gt: 0 },
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
        quantite: { $gt: 0 },
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
}
