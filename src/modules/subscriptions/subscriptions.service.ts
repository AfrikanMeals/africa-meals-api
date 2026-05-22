import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  SubscriptionPlanModel,
} from '@schemas/subscription-plan.schema';
import { StoreModel } from '@schemas/store.schema';
import { VendorSubscriptionModel } from '@schemas/vendor-subscription.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import {
  CreateSubscriptionPlanDto,
  UpdateSubscriptionPlanDto,
} from './dto/subscription-plan.dto';

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
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    plan: plan ? mapPlan(plan) : undefined,
  };
}

@Injectable()
export class SubscriptionsService {
  @InjectModel(SubscriptionPlanModel.name)
  private readonly planModel: Model<SubscriptionPlanModel>;

  @InjectModel(VendorSubscriptionModel.name)
  private readonly vendorSubModel: Model<VendorSubscriptionModel>;

  @InjectModel(StoreModel.name)
  private readonly storeModel: Model<StoreModel>;

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

  async createPlan(user: UserModel, dto: CreateSubscriptionPlanDto) {
    this.assertAdmin(user);
    const features = (dto.features ?? [])
      .map((f) => f.trim())
      .filter(Boolean);
    const doc = await this.planModel.create({
      name: dto.name.trim(),
      description: (dto.description ?? '').trim(),
      priceMonthly: dto.priceMonthly,
      priceYearly: dto.priceYearly,
      currency: (dto.currency ?? 'CAD').trim().toUpperCase() || 'CAD',
      features,
      active: dto.active !== false,
      sortOrder: dto.sortOrder ?? 0,
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

    const updated = await this.planModel
      .findByIdAndUpdate(planId, { $set: patch }, { new: true })
      .lean()
      .exec();
    if (!updated) throw new NotFoundException('plan_not_found');
    return mapPlan(updated as Record<string, unknown>);
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
      (plans as Record<string, unknown>[]).map((p) => [
        String(p._id),
        p,
      ]),
    );

    const mapped = (rows as Record<string, unknown>[]).map((r) =>
      mapVendorSubscription(r, {
        plan: planById.get(String(r.plan)),
      }),
    );

    const activeCandidates = mapped.filter((s) => s.status === 'ACTIVE');
    let active = activeCandidates.find(
      (s) => new Date(s.endsAt).getTime() > now.getTime(),
    );
    active ??= activeCandidates[0];

    const history = mapped.filter((s) => s.status !== 'PENDING_PAYMENT');

    return {
      active: active ?? null,
      history,
    };
  }
}
