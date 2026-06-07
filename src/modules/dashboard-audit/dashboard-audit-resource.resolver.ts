import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { DrinkModel } from '@schemas/drink.schema';
import { ProductCategoryModel } from '@schemas/product-category.schema';
import { ProductModel } from '@schemas/product.schema';
import { StoreCouponModel } from '@schemas/store_coupon.schema';
import { Model, Types } from 'mongoose';
import { Request } from 'express';

export type DashboardAuditResourceHint = {
  resource?: string;
  resourceId?: string;
  resourceName?: string;
};

const OBJECT_ID = '[0-9a-fA-F]{24}';

function stripApiPrefix(path: string): string {
  const p = path.split('?')[0] ?? path;
  if (p.startsWith('/api/')) return p.slice(4);
  if (p === '/api') return '/';
  return p;
}

function trimLabel(value: unknown, max = 128): string | undefined {
  if (typeof value !== 'string') return undefined;
  const s = value.trim();
  return s ? s.slice(0, max) : undefined;
}

function nameFromBody(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const o = body as Record<string, unknown>;
  return (
    trimLabel(o.title) ??
    trimLabel(o.name) ??
    trimLabel(o.code) ??
    trimLabel(o.label)
  );
}

function nameFromResponse(body: unknown): string | undefined {
  if (Array.isArray(body) && body.length === 1) {
    return nameFromResponse(body[0]);
  }
  return nameFromBody(body);
}

function headerResourceName(req: Request): string | undefined {
  const raw = req.headers['x-dashboard-resource-name'];
  const v =
    typeof raw === 'string'
      ? raw.trim()
      : Array.isArray(raw)
        ? String(raw[0] ?? '').trim()
        : '';
  return v ? v.slice(0, 128) : undefined;
}

@Injectable()
export class DashboardAuditResourceResolver {
  @InjectModel(ProductModel.name)
  private readonly productModel: Model<ProductModel>;

  @InjectModel(DrinkModel.name)
  private readonly drinkModel: Model<DrinkModel>;

  @InjectModel(ProductCategoryModel.name)
  private readonly categoryModel: Model<ProductCategoryModel>;

  @InjectModel(StoreCouponModel.name)
  private readonly couponModel: Model<StoreCouponModel>;

  async resolveBefore(
    req: Request,
    apiPath: string,
    method: string,
  ): Promise<DashboardAuditResourceHint> {
    const fromHeader = headerResourceName(req);
    if (fromHeader) {
      return { resourceName: fromHeader };
    }

    const p = stripApiPrefix(apiPath);
    const m = method.toUpperCase();
    const bodyName = m === 'POST' || m === 'PATCH' || m === 'PUT'
      ? nameFromBody(req.body)
      : undefined;

    const productMatch = p.match(
      new RegExp(`^/stores/(${OBJECT_ID})/products/(${OBJECT_ID})`, 'i'),
    );
    if (productMatch) {
      const productId = productMatch[2]!;
      const storeId = productMatch[1]!;
      const title = await this.lookupProductTitle(storeId, productId);
      return {
        resource: 'product',
        resourceId: productId,
        resourceName: title ?? bodyName,
      };
    }

    if (
      m === 'POST' &&
      new RegExp(`^/stores/${OBJECT_ID}/(product-json|product)/?$`, 'i').test(p)
    ) {
      return {
        resource: 'product',
        resourceName: bodyName,
      };
    }

    const drinkMatch = p.match(
      new RegExp(`^/stores/(${OBJECT_ID})/drinks/(${OBJECT_ID})`, 'i'),
    );
    if (drinkMatch) {
      const drinkId = drinkMatch[2]!;
      const name = await this.lookupDrinkName(drinkId);
      return {
        resource: 'drink',
        resourceId: drinkId,
        resourceName: name ?? bodyName,
      };
    }

    const categoryMatch = p.match(
      new RegExp(`^/product-categories/(${OBJECT_ID})`, 'i'),
    );
    if (categoryMatch) {
      const categoryId = categoryMatch[1]!;
      const title = await this.lookupCategoryTitle(categoryId);
      return {
        resource: 'category',
        resourceId: categoryId,
        resourceName: title ?? bodyName,
      };
    }

    const couponMatch = p.match(new RegExp(`^/coupons/(${OBJECT_ID})`, 'i'));
    if (couponMatch) {
      const couponId = couponMatch[1]!;
      const code = await this.lookupCouponCode(couponId);
      return {
        resource: 'coupon',
        resourceId: couponId,
        resourceName: code ?? bodyName,
      };
    }

    if (bodyName) {
      return { resourceName: bodyName };
    }

    return {};
  }

  enrichFromResponse(
    hint: DashboardAuditResourceHint,
    body: unknown,
    method: string,
  ): DashboardAuditResourceHint {
    if (hint.resourceName?.trim()) return hint;
    const fromResponse = nameFromResponse(body);
    if (!fromResponse) return hint;

    const m = method.toUpperCase();
    if (m !== 'POST' && m !== 'PATCH' && m !== 'PUT') return hint;

    return { ...hint, resourceName: fromResponse };
  }

  private async lookupProductTitle(
    storeId: string,
    productId: string,
  ): Promise<string | undefined> {
    if (!Types.ObjectId.isValid(storeId) || !Types.ObjectId.isValid(productId)) {
      return undefined;
    }
    const doc = await this.productModel
      .findOne({
        _id: new Types.ObjectId(productId),
        store: new Types.ObjectId(storeId),
      })
      .select('title')
      .lean()
      .exec();
    return trimLabel(doc?.title);
  }

  private async lookupDrinkName(drinkId: string): Promise<string | undefined> {
    if (!Types.ObjectId.isValid(drinkId)) return undefined;
    const doc = await this.drinkModel
      .findById(drinkId)
      .select('name')
      .lean()
      .exec();
    return trimLabel(doc?.name);
  }

  private async lookupCategoryTitle(
    categoryId: string,
  ): Promise<string | undefined> {
    if (!Types.ObjectId.isValid(categoryId)) return undefined;
    const doc = await this.categoryModel
      .findById(categoryId)
      .select('title')
      .lean()
      .exec();
    return trimLabel(doc?.title);
  }

  private async lookupCouponCode(couponId: string): Promise<string | undefined> {
    if (!Types.ObjectId.isValid(couponId)) return undefined;
    const doc = await this.couponModel
      .findById(couponId)
      .select('code')
      .lean()
      .exec();
    return trimLabel(doc?.code);
  }
}
