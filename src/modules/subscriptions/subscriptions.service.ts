import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { DrinkModel } from '@schemas/drink.schema';
import { ProductModel } from '@schemas/product.schema';
import { SubscriptionPlanModel } from '@schemas/subscription-plan.schema';
import { StoreModel } from '@schemas/store.schema';
import { VendorSubscriptionModel } from '@schemas/vendor-subscription.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import {
  CreateSubscriptionPlanDto,
  SubscribeVendorDto,
  UpdateSubscriptionPlanDto,
} from './dto/subscription-plan.dto';
import {
  isFreePlanName,
  isFreeSubscriptionPlan,
  resolvePlanTrialFields,
} from './subscription-plan.util';
import { DEFAULT_SUBSCRIPTION_PLAN_SEEDS } from './subscription-plan.seed';

function vendorStoreObjectIds(user: UserModel): Types.ObjectId[] {
  const rawStores = user.stores || [];
  const ids: Types.ObjectId[] = [];
  for (const s of rawStores) {
    if (typeof s === 'object' && s !== null && '_id' in s) {
      const id = (s as { _id: unknown })._id;
      ids.push(
        id instanceof Types.ObjectId ? id : new Types.ObjectId(String(id)),
      );
    } else if (s) {
      ids.push(new Types.ObjectId(String(s)));
    }
  }
  return ids;
}

function mapPlan(doc: Record<string, unknown>) {
  return {
    id: String(doc._id),
    name: String(doc.name ?? ''),
    description: String(doc.description ?? ''),
    priceMonthly: Number(doc.priceMonthly ?? 0),
    priceYearly: Number(doc.priceYearly ?? 0),
    currency: String(doc.currency ?? 'CAD'),
    features: Array.isArray(doc.features)
      ? doc.features.map((f) => String(f))
      : [],
    active: doc.active !== false,
    sortOrder: Number(doc.sortOrder ?? 0),
    trialDays: Number(doc.trialDays ?? 0),
    trialReminderDays: Array.isArray(doc.trialReminderDays)
      ? doc.trialReminderDays.map((d) => Number(d)).filter((d) => d > 0)
      : [],
    maxStores: Math.max(0, Number(doc.maxStores ?? 0)),
    mobileAccess: doc.mobileAccess === true,
    maxCatalogItems: Math.max(0, Number(doc.maxCatalogItems ?? 0)),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function mapVendorSubscription(
  doc: Record<string, unknown>,
  extras?: { storeName?: string; plan?: Record<string, unknown> },
) {
  const plan = extras?.plan;
  return {
    id: String(doc._id),
    storeId: String(doc.store),
    storeName: extras?.storeName ?? '',
    ownerId: String(doc.owner),
    planId: String(doc.plan),
    planName: String(doc.planName ?? plan?.name ?? ''),
    billingPeriod: String(doc.billingPeriod),
    status: String(doc.status),
    startsAt:
      doc.startsAt instanceof Date
        ? doc.startsAt.toISOString()
        : new Date(String(doc.startsAt)).toISOString(),
    endsAt:
      doc.endsAt instanceof Date
        ? doc.endsAt.toISOString()
        : new Date(String(doc.endsAt)).toISOString(),
    pricePaid: Number(doc.pricePaid ?? 0),
    currency: String(doc.currency ?? 'CAD'),
    isTrial: doc.isTrial === true,
    trialEndsAt:
      doc.trialEndsAt instanceof Date
        ? doc.trialEndsAt.toISOString()
        : doc.trialEndsAt
        ? new Date(String(doc.trialEndsAt)).toISOString()
        : null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    plan: plan ? mapPlan(plan) : undefined,
  };
}

function normalizedPlanName(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/_/g, '');
}

@Injectable()
export class SubscriptionsService implements OnModuleInit {
  private readonly logger = new Logger(SubscriptionsService.name);

  @InjectModel(SubscriptionPlanModel.name)
  private readonly planModel: Model<SubscriptionPlanModel>;

  @InjectModel(VendorSubscriptionModel.name)
  private readonly vendorSubModel: Model<VendorSubscriptionModel>;

  @InjectModel(StoreModel.name)
  private readonly storeModel: Model<StoreModel>;

  @InjectModel(ProductModel.name)
  private readonly productModel: Model<ProductModel>;

  @InjectModel(DrinkModel.name)
  private readonly drinkModel: Model<DrinkModel>;

  async onModuleInit() {
    await this.ensureDefaultPlansSeeded();
    await this.deactivateRemovedPlans();
    await this.migrateLegacyPlanNames();
    await this.migrateLegacyPlanReferencesToPro();
    await this.expireElapsedActiveSubscriptions();
    await this.ensureDefaultFreePlanForStoresWithoutActiveSubscription();
  }

  private assertAdmin(user: UserModel) {
    if (user.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('admin_only');
    }
  }

  async listPlans(user: UserModel, includeInactive = false) {
    const filter: Record<string, unknown> = {};
    if (user.type !== UserTypeEnum.ADMIN || !includeInactive) {
      filter.active = true;
    }
    const rows = await this.planModel
      .find(filter)
      .sort({ sortOrder: 1, createdAt: 1 })
      .lean()
      .exec();
    return (rows as Record<string, unknown>[]).map(mapPlan);
  }

  private normalizeStoreObjectId(
    storeId: string | Types.ObjectId,
  ): Types.ObjectId {
    return storeId instanceof Types.ObjectId
      ? storeId
      : new Types.ObjectId(String(storeId));
  }

  private normalizeUserObjectId(
    userId: string | Types.ObjectId,
  ): Types.ObjectId {
    return userId instanceof Types.ObjectId
      ? userId
      : new Types.ObjectId(String(userId));
  }

  private pickPreferredStoreSubscription(
    rows: Record<string, unknown>[],
  ): Record<string, unknown> | null {
    if (!rows.length) return null;
    const nowMs = Date.now();
    const valid = rows.filter((s) => {
      if (String(s.status ?? '') !== 'ACTIVE') return false;
      const end = new Date(String(s.endsAt ?? '')).getTime();
      return !Number.isNaN(end) && end > nowMs;
    });
    if (valid.length) {
      valid.sort(
        (a, b) =>
          new Date(String(b.endsAt ?? '')).getTime() -
          new Date(String(a.endsAt ?? '')).getTime(),
      );
      return valid[0] ?? null;
    }
    return null;
  }

  private async findPreferredStoreSubscription(
    storeId: string | Types.ObjectId,
  ): Promise<Record<string, unknown> | null> {
    const sid = this.normalizeStoreObjectId(storeId);
    const rows = await this.vendorSubModel
      .find({ store: sid, status: 'ACTIVE' })
      .sort({ endsAt: -1, createdAt: -1 })
      .lean()
      .exec();
    return this.pickPreferredStoreSubscription(
      rows as Record<string, unknown>[],
    );
  }

  private async findDefaultFreePlan(): Promise<Record<string, unknown> | null> {
    const rows = await this.planModel
      .find({ active: true })
      .sort({ sortOrder: 1, createdAt: 1 })
      .lean()
      .exec();
    for (const row of rows as Record<string, unknown>[]) {
      const candidate = {
        name: String(row.name ?? ''),
        priceMonthly: Number(row.priceMonthly ?? 0),
        priceYearly: Number(row.priceYearly ?? 0),
      };
      if (isFreeSubscriptionPlan(candidate)) {
        return row;
      }
    }
    return null;
  }

  private async ensureDefaultPlansSeeded() {
    for (const seed of DEFAULT_SUBSCRIPTION_PLAN_SEEDS) {
      const existing = await this.planModel
        .findOne({ name: seed.name.trim() })
        .select('_id')
        .lean()
        .exec();
      if (existing) continue;
      const trial = resolvePlanTrialFields({
        name: seed.name,
        priceMonthly: seed.priceMonthly,
        priceYearly: seed.priceYearly,
        trialDays: seed.trialDays,
        trialReminderDays: seed.trialReminderDays,
      });
      await this.planModel.create({
        name: seed.name.trim(),
        description: seed.description.trim(),
        priceMonthly: seed.priceMonthly,
        priceYearly: seed.priceYearly,
        currency: seed.currency.trim().toUpperCase() || 'CAD',
        features: seed.features.map((f) => f.trim()).filter(Boolean),
        active: seed.active !== false,
        sortOrder: seed.sortOrder ?? 0,
        trialDays: trial.trialDays,
        trialReminderDays: trial.trialReminderDays,
        maxStores: Math.max(0, Number(seed.maxStores ?? 0)),
        mobileAccess: seed.mobileAccess === true,
        maxCatalogItems: Math.max(0, Number(seed.maxCatalogItems ?? 0)),
      });
      this.logger.log(`Seed abonnement créé: ${seed.name}`);
    }
  }

  /**
   * Expire les abonnements actifs dont la date de fin est dépassée.
   * Idempotent: rejouable sans effet secondaire.
   */
  async expireElapsedActiveSubscriptions(now = new Date()): Promise<number> {
    const result = await this.vendorSubModel
      .updateMany(
        {
          status: 'ACTIVE',
          endsAt: { $lte: now },
        },
        {
          $set: {
            status: 'EXPIRED',
            endsAt: now,
          },
        },
      )
      .exec();
    const modified = Number(result.modifiedCount ?? 0);
    if (modified > 0) {
      this.logger.log(
        `Abonnements expirés automatiquement: ${modified} ligne(s)`,
      );
    }
    return modified;
  }

  private async deactivateRemovedPlans() {
    const deprecatedNames = ['PRO+'];
    for (const planName of deprecatedNames) {
      await this.planModel
        .updateMany(
          { name: planName, active: true },
          { $set: { active: false } },
        )
        .exec();
    }
  }

  /**
   * Harmonise les abonnements historiques après suppression de PRO+.
   * Idempotent: rejouable sans effet secondaire.
   */
  private async migrateLegacyPlanNames() {
    const legacyNames = ['PRO+', 'PROPLUS'];
    const result = await this.vendorSubModel
      .updateMany(
        { planName: { $in: legacyNames } },
        { $set: { planName: 'PRO' } },
      )
      .exec();
    if ((result.modifiedCount ?? 0) > 0) {
      this.logger.log(
        `Migration abonnements legacy PRO+ -> PRO: ${result.modifiedCount} ligne(s)`,
      );
    }
  }

  /**
   * Réaligne les références ObjectId `plan` des abonnements historiques
   * pointant vers des plans legacy (PRO+) vers le plan PRO courant.
   * Idempotent: rejouable sans effet secondaire.
   */
  private async migrateLegacyPlanReferencesToPro() {
    const proPlan = await this.planModel
      .findOne({ name: 'PRO' })
      .sort({ active: -1, sortOrder: 1, createdAt: 1 })
      .select('_id')
      .lean()
      .exec();
    if (!proPlan?._id) {
      this.logger.warn('Migration legacy PRO+ ignorée: aucun plan PRO trouvé.');
      return;
    }

    const legacyPlans = await this.planModel
      .find({ name: { $in: ['PRO+', 'PROPLUS'] } })
      .select('_id')
      .lean()
      .exec();
    const legacyPlanIds = legacyPlans
      .map((p) => p?._id)
      .filter((id): id is Types.ObjectId => id instanceof Types.ObjectId);
    if (!legacyPlanIds.length) {
      return;
    }

    const result = await this.vendorSubModel
      .updateMany(
        { plan: { $in: legacyPlanIds } },
        { $set: { plan: proPlan._id, planName: 'PRO' } },
      )
      .exec();
    if ((result.modifiedCount ?? 0) > 0) {
      this.logger.log(
        `Migration références plan legacy PRO+ -> PRO: ${result.modifiedCount} ligne(s)`,
      );
    }
  }

  async ensureStoreDefaultFreePlan(
    storeId: string | Types.ObjectId,
    ownerId: string | Types.ObjectId,
  ): Promise<void> {
    const sid = this.normalizeStoreObjectId(storeId);
    const oid = this.normalizeUserObjectId(ownerId);
    const preferred = await this.findPreferredStoreSubscription(sid);
    if (preferred) return;

    let freePlan = await this.findDefaultFreePlan();
    if (!freePlan) {
      await this.ensureDefaultPlansSeeded();
      freePlan = await this.findDefaultFreePlan();
    }
    if (!freePlan) {
      this.logger.warn(
        `Aucun plan FREE disponible pour la boutique ${String(sid)}`,
      );
      return;
    }

    const now = new Date();
    const endsAt = new Date(now);
    endsAt.setFullYear(endsAt.getFullYear() + 50);
    const planName = String(freePlan.name ?? 'FREE');
    const currency =
      String(freePlan.currency ?? 'CAD')
        .trim()
        .toUpperCase() || 'CAD';
    await this.vendorSubModel.create({
      store: sid,
      owner: oid,
      plan: freePlan._id as Types.ObjectId,
      billingPeriod: 'MONTHLY',
      status: 'ACTIVE',
      startsAt: now,
      endsAt,
      pricePaid: 0,
      currency,
      planName,
      isTrial: false,
      trialEndsAt: null,
      trialRemindersSent: [],
    });
  }

  async isStoreOnFreePlan(storeId: string | Types.ObjectId): Promise<boolean> {
    const preferred = await this.findPreferredStoreSubscription(storeId);
    if (!preferred) {
      return true;
    }
    const planName = String(preferred.planName ?? '');
    if (isFreePlanName(planName)) {
      return true;
    }
    const planId = String(preferred.plan ?? '');
    if (!Types.ObjectId.isValid(planId)) {
      return false;
    }
    const plan = await this.planModel.findById(planId).lean().exec();
    if (!plan) return false;
    return isFreeSubscriptionPlan({
      name: String(plan.name ?? ''),
      priceMonthly: Number(plan.priceMonthly ?? 0),
      priceYearly: Number(plan.priceYearly ?? 0),
    });
  }

  private catalogLimitFromPlanDoc(
    plan: Record<string, unknown> | null,
  ): number | null {
    if (!plan) return null;
    if (Object.prototype.hasOwnProperty.call(plan, 'maxCatalogItems')) {
      const configured = Math.max(0, Number(plan.maxCatalogItems ?? 0));
      return configured > 0 ? configured : null;
    }
    const free = isFreeSubscriptionPlan({
      name: String(plan.name ?? ''),
      priceMonthly: Number(plan.priceMonthly ?? 0),
      priceYearly: Number(plan.priceYearly ?? 0),
    });
    // Compat legacy: anciens plans FREE sans champ explicite.
    return free ? 10 : null;
  }

  async resolveCatalogItemLimitForStore(
    storeId: string | Types.ObjectId,
  ): Promise<number | null> {
    const preferred = await this.findPreferredStoreSubscription(storeId);
    if (!preferred) {
      const freePlan = await this.findDefaultFreePlan();
      return this.catalogLimitFromPlanDoc(freePlan);
    }
    const planName = String(preferred.planName ?? '');
    const planId = String(preferred.plan ?? '');
    if (!Types.ObjectId.isValid(planId)) {
      return isFreePlanName(planName) ? 10 : null;
    }
    const plan = await this.planModel.findById(planId).lean().exec();
    if (!plan) {
      return isFreePlanName(planName) ? 10 : null;
    }
    return this.catalogLimitFromPlanDoc(plan as Record<string, unknown>);
  }

  async resolveAccessibleCatalogIdsForStore(
    storeId: string | Types.ObjectId,
  ): Promise<{
    productIds: Set<string>;
    drinkIds: Set<string>;
    limit: number | null;
  }> {
    const sid = this.normalizeStoreObjectId(storeId);
    const limit = await this.resolveCatalogItemLimitForStore(sid);
    if (limit == null) {
      return {
        productIds: new Set<string>(),
        drinkIds: new Set<string>(),
        limit: null,
      };
    }
    if (limit <= 0) {
      return {
        productIds: new Set<string>(),
        drinkIds: new Set<string>(),
        limit: 0,
      };
    }

    const [products, drinks] = await Promise.all([
      this.productModel
        .find({ store: sid })
        .select('_id createdAt')
        .lean()
        .exec(),
      this.drinkModel
        .find({ store: sid })
        .select('_id createdAt')
        .lean()
        .exec(),
    ]);

    const toCreatedAtMs = (raw: unknown): number => {
      if (raw instanceof Date) return raw.getTime();
      if (typeof raw === 'string') {
        const ts = Date.parse(raw);
        return Number.isFinite(ts) ? ts : Number.MIN_SAFE_INTEGER;
      }
      return Number.MIN_SAFE_INTEGER;
    };

    const timeline = [
      ...products.map((p) => {
        const row = p as Record<string, unknown>;
        return {
          id: String(row._id ?? ''),
          type: 'product' as const,
          createdAtMs: toCreatedAtMs(row.createdAt),
        };
      }),
      ...drinks.map((d) => {
        const row = d as Record<string, unknown>;
        return {
          id: String(row._id ?? ''),
          type: 'drink' as const,
          createdAtMs: toCreatedAtMs(row.createdAt),
        };
      }),
    ];

    timeline.sort((a, b) => {
      if (a.createdAtMs !== b.createdAtMs) return a.createdAtMs - b.createdAtMs;
      return a.id.localeCompare(b.id);
    });

    const kept = timeline.slice(0, limit);
    const productIds = new Set(
      kept.filter((e) => e.type === 'product').map((e) => e.id),
    );
    const drinkIds = new Set(
      kept.filter((e) => e.type === 'drink').map((e) => e.id),
    );
    return { productIds, drinkIds, limit };
  }

  async isCatalogItemAccessibleForStore(
    storeId: string | Types.ObjectId,
    itemId: string | Types.ObjectId,
    itemType: 'product' | 'drink',
  ): Promise<boolean> {
    const resolved = await this.resolveAccessibleCatalogIdsForStore(storeId);
    if (resolved.limit == null) return true;
    const id = String(itemId);
    return itemType === 'product'
      ? resolved.productIds.has(id)
      : resolved.drinkIds.has(id);
  }

  private storeLimitFromPlanName(name: string): number | null | undefined {
    const normalized = normalizedPlanName(name);
    if (!normalized) return undefined;
    if (normalized === 'FREE' || normalized.startsWith('FREE')) return 1;
    if (normalized === 'STANDARD') return 3;
    if (
      normalized === 'PRO' ||
      normalized === 'PRO+' ||
      normalized === 'PROPLUS' ||
      normalized.startsWith('PROPLUS') ||
      normalized.startsWith('PRO+')
    ) {
      return null;
    }
    return undefined;
  }

  private storeLimitFromPlanDoc(
    plan: Record<string, unknown> | null,
  ): number | null {
    if (!plan) return null;
    if (Object.prototype.hasOwnProperty.call(plan, 'maxStores')) {
      const configured = Math.max(0, Number(plan.maxStores ?? 0));
      if (configured === 0) return null;
      return configured;
    }
    const byName = this.storeLimitFromPlanName(String(plan.name ?? ''));
    if (byName !== undefined) return byName;
    const free = isFreeSubscriptionPlan({
      name: String(plan.name ?? ''),
      priceMonthly: Number(plan.priceMonthly ?? 0),
      priceYearly: Number(plan.priceYearly ?? 0),
    });
    return free ? 1 : null;
  }

  /**
   * Limite de création de boutiques par propriétaire selon sa meilleure formule active.
   * - FREE => 1
   * - STANDARD => 3
   * - PRO / PRO+ (et autres formules payantes) => illimité (null)
   */
  async resolveStoreCreationLimitForOwner(
    ownerId: string | Types.ObjectId,
  ): Promise<number | null> {
    const oid = this.normalizeUserObjectId(ownerId);
    const now = new Date();
    const subs = await this.vendorSubModel
      .find({
        owner: oid,
        status: 'ACTIVE',
        endsAt: { $gt: now },
      })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    if (!subs.length) {
      return 1;
    }

    const planIds = [
      ...new Set(
        (subs as Array<{ plan?: Types.ObjectId }>)
          .map((s) => String(s.plan ?? ''))
          .filter((id) => Types.ObjectId.isValid(id)),
      ),
    ];
    const plans = await this.planModel
      .find({ _id: { $in: planIds } })
      .lean()
      .exec();
    const planById = new Map(
      (plans as Record<string, unknown>[]).map((p) => [String(p._id), p]),
    );

    let bestLimit = 1;
    for (const sub of subs as Record<string, unknown>[]) {
      const byName = this.storeLimitFromPlanName(String(sub.planName ?? ''));
      const limit =
        byName !== undefined
          ? byName
          : this.storeLimitFromPlanDoc(
              planById.get(String(sub.plan ?? '')) ?? null,
            );
      if (limit === null) return null;
      bestLimit = Math.max(bestLimit, limit);
    }
    return bestLimit;
  }

  /**
   * Liste des boutiques accessibles pour un propriétaire selon son quota courant.
   * En cas de downgrade, les boutiques excédentaires les plus récentes deviennent inaccessibles
   * (elles ne sont pas supprimées).
   */
  async resolveAccessibleStoreIdsForOwner(
    ownerId: string | Types.ObjectId,
  ): Promise<string[]> {
    const oid = this.normalizeUserObjectId(ownerId);
    const rows = await this.storeModel
      .find({ owner: oid })
      .select('_id')
      .sort({ createdAt: 1, _id: 1 })
      .lean()
      .exec();
    const all = rows.map((r) => String(r._id));
    const limit = await this.resolveStoreCreationLimitForOwner(oid);
    if (limit == null) return all;
    if (limit <= 0) return [];
    return all.slice(0, limit);
  }

  async resolvePlanDowngradeImpactForOwner(
    ownerId: string | Types.ObjectId,
  ): Promise<{ hiddenStores: number; hiddenCatalogItems: number }> {
    const oid = this.normalizeUserObjectId(ownerId);
    const rows = await this.storeModel
      .find({ owner: oid })
      .select('_id')
      .sort({ createdAt: 1, _id: 1 })
      .lean()
      .exec();
    const allStoreIds = rows.map((r) => String(r._id));
    if (!allStoreIds.length) {
      return { hiddenStores: 0, hiddenCatalogItems: 0 };
    }

    const accessibleStoreIds = new Set(
      await this.resolveAccessibleStoreIdsForOwner(oid),
    );
    const hiddenStores = allStoreIds.reduce(
      (acc, storeId) => (accessibleStoreIds.has(storeId) ? acc : acc + 1),
      0,
    );

    const hiddenCatalogCounts = await Promise.all(
      allStoreIds.map(async (storeId) => {
        const limit = await this.resolveCatalogItemLimitForStore(storeId);
        if (limit == null || limit <= 0) return 0;
        const [foods, drinks] = await Promise.all([
          this.productModel.countDocuments({ store: storeId }).exec(),
          this.drinkModel.countDocuments({ store: storeId }).exec(),
        ]);
        return Math.max(0, foods + drinks - limit);
      }),
    );

    return {
      hiddenStores,
      hiddenCatalogItems: hiddenCatalogCounts.reduce((acc, n) => acc + n, 0),
    };
  }

  /**
   * Entretien lifecycle: expire abonnements échus puis garantit un FREE actif
   * sur les boutiques sans abonnement en cours.
   */
  async reconcileSubscriptionLifecycle(now = new Date()): Promise<void> {
    await this.expireElapsedActiveSubscriptions(now);
    await this.ensureDefaultFreePlanForStoresWithoutActiveSubscription();
  }

  private async ensureDefaultFreePlanForStoresWithoutActiveSubscription() {
    const stores = await this.storeModel
      .find({})
      .select('_id owner')
      .lean()
      .exec();
    for (const store of stores) {
      const ownerRaw = (store as { owner?: unknown }).owner;
      const ownerId = ownerRaw ? String(ownerRaw) : '';
      if (!Types.ObjectId.isValid(ownerId)) continue;
      await this.ensureStoreDefaultFreePlan(String(store._id), ownerId);
    }
  }

  async createPlan(user: UserModel, dto: CreateSubscriptionPlanDto) {
    this.assertAdmin(user);
    const features = (dto.features ?? []).map((f) => f.trim()).filter(Boolean);
    const trial = resolvePlanTrialFields({
      name: dto.name,
      priceMonthly: dto.priceMonthly,
      priceYearly: dto.priceYearly,
      trialDays: dto.trialDays,
      trialReminderDays: dto.trialReminderDays,
    });
    const doc = await this.planModel.create({
      name: dto.name.trim(),
      description: (dto.description ?? '').trim(),
      priceMonthly: dto.priceMonthly,
      priceYearly: dto.priceYearly,
      currency: (dto.currency ?? 'CAD').trim().toUpperCase() || 'CAD',
      features,
      active: dto.active !== false,
      sortOrder: dto.sortOrder ?? 0,
      trialDays: trial.trialDays,
      trialReminderDays: trial.trialReminderDays,
      maxStores: Math.max(0, Math.floor(Number(dto.maxStores ?? 0))),
      mobileAccess: dto.mobileAccess === true,
      maxCatalogItems: Math.max(
        0,
        Math.floor(Number(dto.maxCatalogItems ?? 0)),
      ),
    });
    return mapPlan(doc.toObject() as Record<string, unknown>);
  }

  async updatePlan(
    user: UserModel,
    planId: string,
    dto: UpdateSubscriptionPlanDto,
  ) {
    this.assertAdmin(user);
    if (!Types.ObjectId.isValid(planId)) {
      throw new NotFoundException('plan_not_found');
    }
    const patch: Record<string, unknown> = {};
    if (dto.name != null) patch.name = dto.name.trim();
    if (dto.description != null) patch.description = dto.description.trim();
    if (dto.priceMonthly != null) patch.priceMonthly = dto.priceMonthly;
    if (dto.priceYearly != null) patch.priceYearly = dto.priceYearly;
    if (dto.currency != null) {
      patch.currency = dto.currency.trim().toUpperCase() || 'CAD';
    }
    if (dto.features != null) {
      patch.features = dto.features.map((f) => f.trim()).filter(Boolean);
    }
    if (dto.active != null) patch.active = dto.active;
    if (dto.sortOrder != null) patch.sortOrder = dto.sortOrder;
    if (dto.maxStores != null) {
      patch.maxStores = Math.max(0, Math.floor(Number(dto.maxStores)));
    }
    if (dto.mobileAccess != null)
      patch.mobileAccess = dto.mobileAccess === true;
    if (dto.maxCatalogItems != null) {
      patch.maxCatalogItems = Math.max(
        0,
        Math.floor(Number(dto.maxCatalogItems)),
      );
    }

    if (
      dto.trialDays != null ||
      dto.trialReminderDays != null ||
      dto.name != null ||
      dto.priceMonthly != null ||
      dto.priceYearly != null
    ) {
      const current = await this.planModel.findById(planId).lean().exec();
      if (!current) throw new NotFoundException('plan_not_found');
      const merged = {
        name: String(patch.name ?? current.name ?? ''),
        priceMonthly: Number(patch.priceMonthly ?? current.priceMonthly ?? 0),
        priceYearly: Number(patch.priceYearly ?? current.priceYearly ?? 0),
        trialDays:
          dto.trialDays != null
            ? dto.trialDays
            : Number((current as { trialDays?: number }).trialDays ?? 0),
        trialReminderDays:
          dto.trialReminderDays != null
            ? dto.trialReminderDays
            : (current as { trialReminderDays?: number[] }).trialReminderDays ??
              [],
      };
      const trial = resolvePlanTrialFields(merged);
      patch.trialDays = trial.trialDays;
      patch.trialReminderDays = trial.trialReminderDays;
    }

    const updated = await this.planModel
      .findByIdAndUpdate(planId, { $set: patch }, { new: true })
      .lean()
      .exec();
    if (!updated) throw new NotFoundException('plan_not_found');
    return mapPlan(updated as Record<string, unknown>);
  }

  async startVendorTrial(user: UserModel, dto: SubscribeVendorDto) {
    if (user.type !== UserTypeEnum.VENDOR) {
      throw new ForbiddenException('vendor_only');
    }
    const storeIds = vendorStoreObjectIds(user);
    if (!storeIds.length) {
      throw new BadRequestException('no_store');
    }
    const storeId = storeIds[0];
    if (!Types.ObjectId.isValid(dto.planId)) {
      throw new NotFoundException('plan_not_found');
    }
    const period = dto.billingPeriod;
    if (period !== 'MONTHLY' && period !== 'YEARLY') {
      throw new BadRequestException('invalid_billing_period');
    }

    const plan = await this.planModel
      .findOne({ _id: dto.planId, active: true })
      .lean()
      .exec();
    if (!plan) throw new NotFoundException('plan_not_found');

    const trial = resolvePlanTrialFields({
      name: String(plan.name ?? ''),
      priceMonthly: Number(plan.priceMonthly ?? 0),
      priceYearly: Number(plan.priceYearly ?? 0),
      trialDays: Number((plan as { trialDays?: number }).trialDays ?? 0),
      trialReminderDays:
        (plan as { trialReminderDays?: number[] }).trialReminderDays ?? [],
    });
    if (trial.trialDays <= 0) {
      throw new BadRequestException('trial_not_configured');
    }

    const now = new Date();
    const activeExisting = await this.vendorSubModel
      .findOne({
        store: storeId,
        status: 'ACTIVE',
        endsAt: { $gt: now },
      })
      .lean()
      .exec();
    if (activeExisting) {
      throw new BadRequestException('subscription_already_active');
    }

    const priorTrial = await this.vendorSubModel
      .exists({
        store: storeId,
        plan: plan._id,
        isTrial: true,
      })
      .exec();
    if (priorTrial) {
      throw new BadRequestException('trial_already_used');
    }

    await this.vendorSubModel.deleteMany({
      store: storeId,
      status: 'PENDING_PAYMENT',
    });

    const trialEndsAt = new Date(now);
    trialEndsAt.setDate(trialEndsAt.getDate() + trial.trialDays);

    const created = await this.vendorSubModel.create({
      store: storeId,
      owner: user._id,
      plan: plan._id,
      billingPeriod: period,
      status: 'ACTIVE',
      startsAt: now,
      endsAt: trialEndsAt,
      trialEndsAt,
      isTrial: true,
      trialRemindersSent: [],
      pricePaid: 0,
      currency:
        String(plan.currency ?? 'CAD')
          .trim()
          .toUpperCase() || 'CAD',
      planName: String(plan.name ?? ''),
    });

    const nowExpire = new Date();
    await this.vendorSubModel
      .updateMany(
        {
          store: storeId,
          status: 'ACTIVE',
          _id: { $ne: created._id },
        },
        { $set: { status: 'EXPIRED', endsAt: nowExpire } },
      )
      .exec();

    return mapVendorSubscription(created.toObject() as Record<string, unknown>);
  }

  async deletePlan(user: UserModel, planId: string) {
    this.assertAdmin(user);
    if (!Types.ObjectId.isValid(planId)) {
      throw new NotFoundException('plan_not_found');
    }
    const updated = await this.planModel
      .findByIdAndUpdate(planId, { $set: { active: false } }, { new: true })
      .lean()
      .exec();
    if (!updated) throw new NotFoundException('plan_not_found');
    return mapPlan(updated as Record<string, unknown>);
  }

  async permanentlyDeletePlan(user: UserModel, planId: string) {
    this.assertAdmin(user);
    if (!Types.ObjectId.isValid(planId)) {
      throw new NotFoundException('plan_not_found');
    }
    const planOid = new Types.ObjectId(planId);
    const linkedCount = await this.vendorSubModel
      .countDocuments({ plan: planOid })
      .exec();
    if (linkedCount > 0) {
      throw new ConflictException('plan_has_subscriptions');
    }
    const deleted = await this.planModel.findByIdAndDelete(planId).exec();
    if (!deleted) throw new NotFoundException('plan_not_found');
    return { ok: true, id: planId };
  }

  async deactivateVendorSubscriptionAdmin(
    user: UserModel,
    subscriptionId: string,
  ) {
    this.assertAdmin(user);
    if (!Types.ObjectId.isValid(subscriptionId)) {
      throw new NotFoundException('vendor_subscription_not_found');
    }
    const existing = await this.vendorSubModel
      .findById(subscriptionId)
      .lean()
      .exec();
    if (!existing) {
      throw new NotFoundException('vendor_subscription_not_found');
    }
    const status = String(existing.status ?? '');
    if (status !== 'ACTIVE' && status !== 'PENDING_PAYMENT') {
      throw new BadRequestException('vendor_subscription_not_cancellable');
    }
    const now = new Date();
    const endsAt =
      existing.endsAt instanceof Date &&
      existing.endsAt.getTime() < now.getTime()
        ? existing.endsAt
        : now;
    const updated = await this.vendorSubModel
      .findByIdAndUpdate(
        subscriptionId,
        { $set: { status: 'CANCELLED', endsAt } },
        { new: true },
      )
      .lean()
      .exec();
    if (!updated) throw new NotFoundException('vendor_subscription_not_found');

    const storeId = String(existing.store);
    const store = await this.storeModel
      .findById(storeId)
      .select('name')
      .lean()
      .exec();

    return mapVendorSubscription(updated as Record<string, unknown>, {
      storeName: String(store?.name ?? ''),
    });
  }

  async deleteVendorSubscriptionAdmin(user: UserModel, subscriptionId: string) {
    this.assertAdmin(user);
    if (!Types.ObjectId.isValid(subscriptionId)) {
      throw new NotFoundException('vendor_subscription_not_found');
    }
    const deleted = await this.vendorSubModel
      .findByIdAndDelete(subscriptionId)
      .exec();
    if (!deleted) throw new NotFoundException('vendor_subscription_not_found');
    return { ok: true, id: subscriptionId };
  }

  async listVendorSubscriptionsAdmin(user: UserModel) {
    this.assertAdmin(user);
    const rows = await this.vendorSubModel
      .find({})
      .sort({ createdAt: -1 })
      .limit(500)
      .lean()
      .exec();

    const storeIds = [
      ...new Set(
        (rows as { store?: Types.ObjectId }[])
          .map((r) => String(r.store))
          .filter((id) => Types.ObjectId.isValid(id)),
      ),
    ];
    const stores = await this.storeModel
      .find({ _id: { $in: storeIds } })
      .select('name')
      .lean()
      .exec();
    const storeNames = new Map(
      stores.map((s) => [String(s._id), String(s.name ?? '')]),
    );

    return (rows as Record<string, unknown>[]).map((r) =>
      mapVendorSubscription(r, {
        storeName: storeNames.get(String(r.store)) ?? '',
      }),
    );
  }

  private pickPreferredActiveSubscription(
    rows: Record<string, unknown>[],
    now: Date,
  ): Record<string, unknown> | null {
    const nowMs = now.getTime();
    const valid = rows.filter((s) => {
      if (String(s.status ?? '') !== 'ACTIVE') return false;
      const end = new Date(String(s.endsAt ?? '')).getTime();
      return !Number.isNaN(end) && end > nowMs;
    });
    const pool = valid.length
      ? valid
      : rows.filter((s) => s.status === 'ACTIVE');
    if (!pool.length) return null;

    const scored = pool.map((s) => {
      const planName = String(s.planName ?? '');
      const free = isFreePlanName(planName);
      const isTrial = s.isTrial === true;
      const plan = s.plan as Record<string, unknown> | undefined;
      const sortOrder = Number(plan?.sortOrder ?? 0);
      let score = sortOrder;
      if (isTrial && !free) score += 10_000;
      if (!free) score += 1_000;
      return { s, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.s ?? null;
  }

  async getMySubscriptions(user: UserModel) {
    if (user.type !== UserTypeEnum.VENDOR) {
      throw new ForbiddenException('vendor_only');
    }
    const storeIds = vendorStoreObjectIds(user);
    if (!storeIds.length) {
      return { active: null as null, history: [] };
    }

    const now = new Date();
    const rows = await this.vendorSubModel
      .find({ store: { $in: storeIds } })
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    const planIds = [
      ...new Set(
        (rows as { plan?: Types.ObjectId }[]).map((r) => String(r.plan)),
      ),
    ].filter((id) => Types.ObjectId.isValid(id));
    const plans = await this.planModel
      .find({ _id: { $in: planIds } })
      .lean()
      .exec();
    const planById = new Map(
      (plans as Record<string, unknown>[]).map((p) => [String(p._id), p]),
    );

    const mapped = (rows as Record<string, unknown>[]).map((r) =>
      mapVendorSubscription(r, {
        plan: planById.get(String(r.plan)),
      }),
    );

    const active = this.pickPreferredActiveSubscription(mapped, now);

    const history = mapped.filter((s) => s.status !== 'PENDING_PAYMENT');

    return {
      active: active ?? null,
      history,
    };
  }
}
