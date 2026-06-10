import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  PlatformBusinessTypeItemModel,
  PlatformBusinessTypesDocument,
  PlatformBusinessTypesModel,
} from '@schemas/platform-business-types.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model } from 'mongoose';
import { UpdateBusinessTypesDto } from './dto/update-business-types.dto';

const SETTINGS_KEY = 'default';

export type BusinessTypeItemResponse = {
  slug: string;
  labelFr: string;
  labelEn: string;
  sortOrder: number;
  isActive: boolean;
};

const DEFAULT_TYPES: BusinessTypeItemResponse[] = [
  {
    slug: 'RESTAURANT',
    labelFr: 'Restaurant',
    labelEn: 'Restaurant',
    sortOrder: 0,
    isActive: true,
  },
  {
    slug: 'CONVENIENCE_STORE',
    labelFr: 'Dépanneur',
    labelEn: 'Convenience store',
    sortOrder: 1,
    isActive: true,
  },
  {
    slug: 'GROCERY_STORE',
    labelFr: 'Épicerie',
    labelEn: 'Grocery store',
    sortOrder: 2,
    isActive: true,
  },
  {
    slug: 'SPECIALTY_FOOD_STORE',
    labelFr: 'Magasin d’aliments spécialisés',
    labelEn: 'Specialty food store',
    sortOrder: 3,
    isActive: true,
  },
  {
    slug: 'LIQUOR_STORE',
    labelFr: 'Magasin d’alcool',
    labelEn: 'Liquor store',
    sortOrder: 4,
    isActive: true,
  },
  {
    slug: 'FLORIST',
    labelFr: 'Fleuriste',
    labelEn: 'Florist',
    sortOrder: 5,
    isActive: true,
  },
  {
    slug: 'PHARMACY',
    labelFr: 'Pharmacie',
    labelEn: 'Pharmacy',
    sortOrder: 6,
    isActive: true,
  },
];

function assertAdmin(user: UserModel) {
  if (user.type !== UserTypeEnum.ADMIN) {
    throw new ForbiddenException('admin_only');
  }
}

function normalizeSlug(raw: string): string {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function sortTypes(types: BusinessTypeItemResponse[]): BusinessTypeItemResponse[] {
  return [...types].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.labelFr.localeCompare(b.labelFr),
  );
}

@Injectable()
export class BusinessTypesService {
  constructor(
    @InjectModel(PlatformBusinessTypesModel.name)
    private readonly _settings: Model<PlatformBusinessTypesDocument>,
  ) {}

  private _normalizeItem(
    raw: PlatformBusinessTypeItemModel | BusinessTypeItemResponse,
  ): BusinessTypeItemResponse {
    return {
      slug: normalizeSlug(raw.slug),
      labelFr: String(raw.labelFr ?? '').trim(),
      labelEn: String(raw.labelEn ?? '').trim(),
      sortOrder: Number.isFinite(raw.sortOrder) ? Math.trunc(raw.sortOrder) : 0,
      isActive: raw.isActive !== false,
    };
  }

  private _toResponse(types: PlatformBusinessTypeItemModel[]) {
    const normalized = sortTypes(
      (types ?? []).map((row) => this._normalizeItem(row)),
    ).filter((row) => row.slug && row.labelFr && row.labelEn);
    return { types: normalized };
  }

  private async _ensureDocument() {
    const doc = await this._settings
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        {
          $setOnInsert: {
            key: SETTINGS_KEY,
            types: DEFAULT_TYPES,
          },
        },
        { upsert: true, new: true, lean: true, setDefaultsOnInsert: true },
      )
      .exec();
    return doc as PlatformBusinessTypesModel;
  }

  async getPublicTypes() {
    const doc = await this._ensureDocument();
    const all = this._toResponse(doc.types ?? []).types;
    return { types: all.filter((row) => row.isActive) };
  }

  async getAdminTypes() {
    const doc = await this._ensureDocument();
    return this._toResponse(doc.types ?? []);
  }

  async updateTypes(user: UserModel, dto: UpdateBusinessTypesDto) {
    assertAdmin(user);
    const normalized = dto.types.map((row, index) =>
      this._normalizeItem({
        ...row,
        sortOrder:
          Number.isFinite(row.sortOrder) && row.sortOrder >= 0
            ? Math.trunc(row.sortOrder)
            : index,
      }),
    );

    const slugs = normalized.map((row) => row.slug);
    const unique = new Set(slugs);
    if (unique.size !== slugs.length) {
      throw new BadRequestException('duplicate_business_type_slug');
    }

    for (const row of normalized) {
      if (!row.slug || !row.labelFr || !row.labelEn) {
        throw new BadRequestException('invalid_business_type_row');
      }
    }

    const updated = await this._settings
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        { $set: { types: normalized } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();

    return this._toResponse(updated.types ?? []);
  }

  async assertActiveSlug(slug: string | undefined | null) {
    const normalized = normalizeSlug(String(slug ?? ''));
    if (!normalized) return;
    const { types } = await this.getPublicTypes();
    const allowed = new Set(types.map((row) => row.slug));
    if (!allowed.has(normalized)) {
      throw new BadRequestException('invalid_business_type');
    }
  }

  async resolveLabel(
    slug: string | undefined | null,
    locale: 'fr' | 'en' = 'fr',
  ): Promise<string> {
    const normalized = normalizeSlug(String(slug ?? ''));
    if (!normalized) return '';
    const { types } = await this.getAdminTypes();
    const row = types.find((entry) => entry.slug === normalized);
    if (!row) return normalized;
    return locale === 'en' ? row.labelEn : row.labelFr;
  }
}
