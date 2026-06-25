import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { StoreAccessService } from '@modules/teams/store-access.service';
import {
  StoreComplementLibraryModel,
  StoreIngredientLibraryModel,
  StoreSupplementLibraryModel,
} from '@schemas/catalog-library.schema';
import { UserModel } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import {
  CreateComplementLibraryDto,
  CreateIngredientLibraryDto,
  CreateSupplementLibraryDto,
  PatchComplementLibraryDto,
  PatchIngredientLibraryDto,
  PatchSupplementLibraryDto,
} from './dto/catalog-library.dto';

@Injectable()
export class CatalogLibraryService {
  @Inject(StoreAccessService)
  private readonly _storeAccess: StoreAccessService;

  @InjectModel(StoreIngredientLibraryModel.name)
  private readonly _ingredientModel: Model<StoreIngredientLibraryModel>;

  @InjectModel(StoreSupplementLibraryModel.name)
  private readonly _supplementModel: Model<StoreSupplementLibraryModel>;

  @InjectModel(StoreComplementLibraryModel.name)
  private readonly _complementModel: Model<StoreComplementLibraryModel>;

  private filterByStoreId(storeId: string) {
    const sid = String(storeId).trim();
    return {
      $expr: {
        $eq: [{ $toString: '$store' }, sid],
      },
    };
  }

  private storeOid(storeId: string) {
    return Types.ObjectId.isValid(storeId)
      ? new Types.ObjectId(storeId)
      : storeId;
  }

  private async assertAccess(
    storeId: string,
    user: UserModel,
    permission: 'catalog.view' | 'catalog.edit',
  ) {
    await this._storeAccess.assertStoreAccess(user, storeId, permission);
  }

  private isoDate(raw: unknown): string | undefined {
    if (raw instanceof Date) return raw.toISOString();
    return typeof raw === 'string' ? raw : undefined;
  }

  private mapIngredient(doc: Record<string, unknown>) {
    return {
      id: String(doc._id),
      name: String(doc.name ?? '').trim(),
      createdAt: this.isoDate(doc.createdAt),
      updatedAt: this.isoDate(doc.updatedAt),
    };
  }

  private mapSupplement(doc: Record<string, unknown>) {
    const price = Number(doc.defaultPrice ?? doc.default_price ?? 0);
    return {
      id: String(doc._id),
      name: String(doc.name ?? '').trim(),
      defaultPrice: Number.isFinite(price) && price >= 0 ? price : 0,
      createdAt: this.isoDate(doc.createdAt),
      updatedAt: this.isoDate(doc.updatedAt),
    };
  }

  private normalizeComplementOptions(raw: unknown) {
    if (!Array.isArray(raw)) return [];
    const options = raw
      .map((row) => {
        const o = (row ?? {}) as Record<string, unknown>;
        const label = String(o.label ?? '').trim();
        if (!label) return null;
        const numeric = Number(o.defaultPriceDelta ?? o.default_price_delta ?? 0);
        const defaultPriceDelta =
          Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
        return {
          label,
          defaultPriceDelta,
          isDefault: Boolean(o.isDefault ?? o.is_default),
        };
      })
      .filter(
        (
          o,
        ): o is {
          label: string;
          defaultPriceDelta: number;
          isDefault: boolean;
        } => Boolean(o),
      );
    if (!options.length) return [];
    let defaultIndex = options.findIndex((o) => o.isDefault);
    if (defaultIndex < 0) defaultIndex = 0;
    return options.map((o, index) => ({
      ...o,
      isDefault: index === defaultIndex,
    }));
  }

  private mapComplement(doc: Record<string, unknown>) {
    return {
      id: String(doc._id),
      title: String(doc.title ?? '').trim(),
      firstOptionFree: Boolean(
        doc.firstOptionFree ?? doc.first_option_free ?? false,
      ),
      multiChoice: Boolean(doc.multiChoice ?? doc.multi_choice ?? false),
      required: Boolean(doc.required ?? false),
      options: this.normalizeComplementOptions(doc.options),
      createdAt: this.isoDate(doc.createdAt),
      updatedAt: this.isoDate(doc.updatedAt),
    };
  }

  async listIngredients(storeId: string, user: UserModel) {
    await this.assertAccess(storeId, user, 'catalog.view');
    const rows = await this._ingredientModel
      .find(this.filterByStoreId(storeId))
      .sort({ name: 1 })
      .lean()
      .exec();
    return rows.map((r) => this.mapIngredient(r as Record<string, unknown>));
  }

  async createIngredient(
    storeId: string,
    dto: CreateIngredientLibraryDto,
    user: UserModel,
  ) {
    await this.assertAccess(storeId, user, 'catalog.edit');
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('name_required');
    const doc = await this._ingredientModel.create({
      store: this.storeOid(storeId),
      name,
    });
    return this.mapIngredient(doc.toObject() as Record<string, unknown>);
  }

  async patchIngredient(
    storeId: string,
    itemId: string,
    dto: PatchIngredientLibraryDto,
    user: UserModel,
  ) {
    await this.assertAccess(storeId, user, 'catalog.edit');
    const doc = await this._ingredientModel
      .findOne({ _id: itemId, ...this.filterByStoreId(storeId) })
      .exec();
    if (!doc) throw new NotFoundException('ingredient_library_not_found');
    if (dto.name != null) doc.name = dto.name.trim();
    await doc.save();
    return this.mapIngredient(doc.toObject() as Record<string, unknown>);
  }

  async deleteIngredient(storeId: string, itemId: string, user: UserModel) {
    await this.assertAccess(storeId, user, 'catalog.edit');
    const res = await this._ingredientModel
      .deleteOne({ _id: itemId, ...this.filterByStoreId(storeId) })
      .exec();
    if (!res.deletedCount) {
      throw new NotFoundException('ingredient_library_not_found');
    }
  }

  async listSupplements(storeId: string, user: UserModel) {
    await this.assertAccess(storeId, user, 'catalog.view');
    const rows = await this._supplementModel
      .find(this.filterByStoreId(storeId))
      .sort({ name: 1 })
      .lean()
      .exec();
    return rows.map((r) => this.mapSupplement(r as Record<string, unknown>));
  }

  async createSupplement(
    storeId: string,
    dto: CreateSupplementLibraryDto,
    user: UserModel,
  ) {
    await this.assertAccess(storeId, user, 'catalog.edit');
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('name_required');
    const defaultPrice = Number(dto.defaultPrice ?? 0);
    const doc = await this._supplementModel.create({
      store: this.storeOid(storeId),
      name,
      defaultPrice:
        Number.isFinite(defaultPrice) && defaultPrice >= 0 ? defaultPrice : 0,
    });
    return this.mapSupplement(doc.toObject() as Record<string, unknown>);
  }

  async patchSupplement(
    storeId: string,
    itemId: string,
    dto: PatchSupplementLibraryDto,
    user: UserModel,
  ) {
    await this.assertAccess(storeId, user, 'catalog.edit');
    const doc = await this._supplementModel
      .findOne({ _id: itemId, ...this.filterByStoreId(storeId) })
      .exec();
    if (!doc) throw new NotFoundException('supplement_library_not_found');
    if (dto.name != null) doc.name = dto.name.trim();
    if (dto.defaultPrice !== undefined) {
      const n = Number(dto.defaultPrice);
      doc.defaultPrice = Number.isFinite(n) && n >= 0 ? n : 0;
    }
    await doc.save();
    return this.mapSupplement(doc.toObject() as Record<string, unknown>);
  }

  async deleteSupplement(storeId: string, itemId: string, user: UserModel) {
    await this.assertAccess(storeId, user, 'catalog.edit');
    const res = await this._supplementModel
      .deleteOne({ _id: itemId, ...this.filterByStoreId(storeId) })
      .exec();
    if (!res.deletedCount) {
      throw new NotFoundException('supplement_library_not_found');
    }
  }

  async listComplements(storeId: string, user: UserModel) {
    await this.assertAccess(storeId, user, 'catalog.view');
    const rows = await this._complementModel
      .find(this.filterByStoreId(storeId))
      .sort({ title: 1 })
      .lean()
      .exec();
    return rows.map((r) => this.mapComplement(r as Record<string, unknown>));
  }

  async createComplement(
    storeId: string,
    dto: CreateComplementLibraryDto,
    user: UserModel,
  ) {
    await this.assertAccess(storeId, user, 'catalog.edit');
    const title = dto.title.trim();
    if (!title) throw new BadRequestException('title_required');
    const options = this.normalizeComplementOptions(dto.options);
    if (!options.length) throw new BadRequestException('options_required');
    const doc = await this._complementModel.create({
      store: this.storeOid(storeId),
      title,
      firstOptionFree: Boolean(dto.firstOptionFree),
      multiChoice: Boolean(dto.multiChoice),
      required: Boolean(dto.required),
      options,
    });
    return this.mapComplement(doc.toObject() as Record<string, unknown>);
  }

  async patchComplement(
    storeId: string,
    itemId: string,
    dto: PatchComplementLibraryDto,
    user: UserModel,
  ) {
    await this.assertAccess(storeId, user, 'catalog.edit');
    const doc = await this._complementModel
      .findOne({ _id: itemId, ...this.filterByStoreId(storeId) })
      .exec();
    if (!doc) throw new NotFoundException('complement_library_not_found');
    if (dto.title != null) doc.title = dto.title.trim();
    if (dto.firstOptionFree !== undefined) {
      doc.firstOptionFree = Boolean(dto.firstOptionFree);
    }
    if (dto.multiChoice !== undefined) doc.multiChoice = Boolean(dto.multiChoice);
    if (dto.required !== undefined) doc.required = Boolean(dto.required);
    if (dto.options !== undefined) {
      const options = this.normalizeComplementOptions(dto.options);
      if (!options.length) throw new BadRequestException('options_required');
      doc.options = options;
    }
    await doc.save();
    return this.mapComplement(doc.toObject() as Record<string, unknown>);
  }

  async deleteComplement(storeId: string, itemId: string, user: UserModel) {
    await this.assertAccess(storeId, user, 'catalog.edit');
    const res = await this._complementModel
      .deleteOne({ _id: itemId, ...this.filterByStoreId(storeId) })
      .exec();
    if (!res.deletedCount) {
      throw new NotFoundException('complement_library_not_found');
    }
  }
}
