import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { StockManagerSettingsService } from '@modules/stock-manager-settings/stock-manager-settings.service';
import { StoreAccessService } from '@modules/teams/store-access.service';
import { StockItemModel, StockStatutEnum } from '@schemas/stock-item.schema';
import { UserModel } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import { CreateStockItemDto, PatchStockItemDto } from './dto/stock-item.dto';

/** Ancienne collection avant renommage — fusionnée en lecture pour ne pas perdre les données. */
const LEGACY_STOCK_COLLECTION = 'stock_items';

function computeStatut(quantite: number, seuil: number): StockStatutEnum {
  return quantite <= seuil ? StockStatutEnum.ALERTE : StockStatutEnum.OK;
}

function readActive(raw: unknown, fallback = true): boolean {
  if (raw === false || raw === 'false' || raw === 0 || raw === '0') {
    return false;
  }
  if (raw === true || raw === 'true' || raw === 1 || raw === '1') {
    return true;
  }
  return fallback;
}

@Injectable()
export class StockItemsService {
  @Inject(StoreAccessService)
  private readonly _storeAccess: StoreAccessService;

  @Inject(StockManagerSettingsService)
  private readonly _stockManagerSettings: StockManagerSettingsService;

  @InjectModel(StockItemModel.name)
  private readonly _stockItemModel: Model<StockItemModel>;

  private async assertStoreCatalogAccess(
    storeId: string,
    user: UserModel,
    permission: 'catalog.view' | 'catalog.edit',
  ) {
    await this._storeAccess.assertStoreAccess(user, storeId, permission);
  }

  private async assertStockFieldsAllowed(dto: PatchStockItemDto): Promise<void> {
    const stockEnabled =
      await this._stockManagerSettings.isIngredientStockManagementEnabled();
    if (stockEnabled) return;
    const hasStockFields =
      dto.unite !== undefined ||
      dto.quantite !== undefined ||
      dto.seuil !== undefined ||
      dto.prix !== undefined;
    if (hasStockFields) {
      throw new BadRequestException('stock_management_fields_not_allowed');
    }
  }

  /** Compare `store` que ce soit un ObjectId ou une chaîne hex en base (imports manuels Mongo). */
  private filterByStoreId(storeId: string) {
    const sid = String(storeId).trim();
    return {
      $expr: {
        $eq: [{ $toString: '$store' }, sid],
      },
    };
  }

  private mapRow(p: Record<string, unknown>) {
    const quantite = Number(p.quantite ?? 0);
    const seuil = Number(p.seuil ?? 0);
    const statut =
      quantite <= seuil ? StockStatutEnum.ALERTE : StockStatutEnum.OK;
    const created = p.createdAt ?? p.created_at;
    const updated = p.updatedAt ?? p.updated_at;
    const prix = Number(p.prix ?? 0);
    return {
      id: String(p._id),
      produit: String(p.produit ?? ''),
      unite: String(p.unite ?? ''),
      quantite,
      seuil,
      prix,
      statut,
      active: readActive(p.active),
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

  async findByStoreForOwner(storeId: string, user: UserModel) {
    await this.assertStoreCatalogAccess(storeId, user, 'catalog.view');
    const storeFilter = this.filterByStoreId(storeId);

    const [primary, legacy] = await Promise.all([
      this._stockItemModel
        .find(storeFilter)
        .sort({ updatedAt: -1 })
        .lean()
        .exec(),
      this._stockItemModel.db
        .collection(LEGACY_STOCK_COLLECTION)
        .find(storeFilter)
        .sort({ updatedAt: -1 })
        .toArray(),
    ]);

    const byId = new Map<string, Record<string, unknown>>();
    for (const r of legacy) {
      byId.set(String(r._id), r as Record<string, unknown>);
    }
    for (const r of primary) {
      byId.set(String(r._id), r as Record<string, unknown>);
    }

    const rows = [...byId.values()].sort((a, b) => {
      const ta =
        a.updatedAt instanceof Date
          ? a.updatedAt.getTime()
          : new Date(String(a.updatedAt ?? 0)).getTime();
      const tb =
        b.updatedAt instanceof Date
          ? b.updatedAt.getTime()
          : new Date(String(b.updatedAt ?? 0)).getTime();
      return tb - ta;
    });

    return rows.map((r) => this.mapRow(r));
  }

  async createForStore(
    storeId: string,
    dto: CreateStockItemDto,
    user: UserModel,
  ) {
    await this.assertStoreCatalogAccess(storeId, user, 'catalog.edit');
    const stockEnabled =
      await this._stockManagerSettings.isIngredientStockManagementEnabled();
    const unite = String(dto.unite ?? 'kg').trim() || 'kg';
    const quantite = stockEnabled ? Number(dto.quantite ?? 0) : 0;
    const seuil = stockEnabled ? Number(dto.seuil ?? 0) : 0;
    const prix = stockEnabled ? Number(dto.prix ?? 0) : 0;
    const active = readActive(dto.active, true);
    const statut = computeStatut(quantite, seuil);
    const storeOid = Types.ObjectId.isValid(storeId)
      ? new Types.ObjectId(storeId)
      : storeId;
    const doc = await this._stockItemModel.create({
      produit: dto.produit.trim(),
      unite,
      quantite,
      seuil,
      prix,
      statut,
      active,
      store: storeOid,
    });
    return this.mapRow(doc.toObject() as Record<string, unknown>);
  }

  private async findRawInStockCollections(
    storeId: string,
    itemId: string,
  ): Promise<{
    collectionName: string;
    doc: Record<string, unknown>;
  } | null> {
    if (!Types.ObjectId.isValid(itemId)) {
      return null;
    }
    const oid = new Types.ObjectId(itemId);
    const query = {
      _id: oid,
      ...this.filterByStoreId(storeId),
    };
    const db = this._stockItemModel.db;
    const names = [
      this._stockItemModel.collection.name,
      LEGACY_STOCK_COLLECTION,
    ];
    for (const name of names) {
      const hit = (await db.collection(name).findOne(query)) as Record<
        string,
        unknown
      > | null;
      if (hit) {
        return { collectionName: name, doc: hit };
      }
    }
    return null;
  }

  async updateForStore(
    storeId: string,
    itemId: string,
    dto: PatchStockItemDto,
    user: UserModel,
  ) {
    await this.assertStockFieldsAllowed(dto);
    await this.assertStoreCatalogAccess(storeId, user, 'catalog.edit');
    const stockEnabled =
      await this._stockManagerSettings.isIngredientStockManagementEnabled();
    const found = await this.findRawInStockCollections(storeId, itemId);
    if (!found) {
      throw new NotFoundException('stock_item_not_found');
    }
    const { collectionName, doc: hit } = found;
    const quantite =
      stockEnabled && dto.quantite !== undefined
        ? Number(dto.quantite)
        : Number(hit.quantite ?? 0);
    const seuil =
      stockEnabled && dto.seuil !== undefined
        ? Number(dto.seuil)
        : Number(hit.seuil ?? 0);
    const produit =
      dto.produit != null ? dto.produit.trim() : String(hit.produit ?? '');
    const unite =
      stockEnabled && dto.unite != null
        ? dto.unite.trim()
        : String(hit.unite ?? '');
    const prix =
      stockEnabled && dto.prix !== undefined
        ? Number(dto.prix)
        : Number(hit.prix ?? 0);
    const active =
      dto.active !== undefined
        ? readActive(dto.active, true)
        : readActive(hit.active, true);
    const statut = computeStatut(quantite, seuil);
    await this._stockItemModel.db.collection(collectionName).updateOne(
      { _id: hit._id },
      {
        $set: {
          produit,
          unite,
          quantite,
          seuil,
          prix,
          statut,
          active,
          updatedAt: new Date(),
        },
      },
    );
    const after = (await this._stockItemModel.db
      .collection(collectionName)
      .findOne({ _id: hit._id })) as Record<string, unknown>;
    return this.mapRow(after);
  }

  async deleteForStore(storeId: string, itemId: string, user: UserModel) {
    await this.assertStoreCatalogAccess(storeId, user, 'catalog.edit');
    const found = await this.findRawInStockCollections(storeId, itemId);
    if (!found) {
      throw new NotFoundException('stock_item_not_found');
    }
    await this._stockItemModel.db
      .collection(found.collectionName)
      .deleteOne({ _id: found.doc._id });
  }
}
