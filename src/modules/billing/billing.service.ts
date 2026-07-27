import { UsersService } from '@modules/users/users.service';
import { resolvePortalAppBaseUrl } from '@common/portal/portal-app-base-url.util';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import {
  PaymentMethodModel,
  PaymentMetodProviderEnum,
} from '@schemas/payment-method.schema';
import { StoreModel } from '@schemas/store.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import Stripe from 'stripe';
import { PaypalService } from './paypal/paypal.service';
import { StripeConnectService } from './stripe/stripe-connect.service';

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

type LeanStoreBilling = {
  _id: Types.ObjectId;
  name?: string;
  email?: string;
  stripeConnectAccountId?: string;
};

// TODO: For payouts, create a table to store payout transactions for every order
@Injectable()
export class BillingService {
  @InjectModel(PaymentMethodModel.name)
  private readonly _paymentMethodModel: Model<PaymentMethodModel>;

  @InjectModel(StoreModel.name)
  private readonly _storeModel: Model<StoreModel>;

  @Inject(PaypalService) private readonly _paypalService: PaypalService;
  @Inject(UsersService) private readonly _usersService: UsersService;
  @Inject(StripeConnectService)
  private readonly _stripeConnectService: StripeConnectService;
  @Inject(ConfigService) private readonly _config: ConfigService;

  async savePaypalPaymentMethod(setupTokenId: string, user: UserModel) {
    try {
      const token = await this._paypalService.createPaymentToken(
        setupTokenId,
        user,
      );

      const hasMaymentMethod = await this._paymentMethodModel
        .findOne({
          user: new Types.ObjectId(user.id),
        })
        .exec();

      const method = await this._paymentMethodModel.create({
        user,
        isDefault: !hasMaymentMethod,
        provider: token.isCard
          ? PaymentMetodProviderEnum.PAYPAL_CARD
          : PaymentMetodProviderEnum.PAYPAL,
        providerId: token.id,
        prodiderCustomerId: token.customerId,
        ...(token.isCard && {
          card: {
            brand: token.brand,
            last4: token.last4,
            expiry: token.expiry,
            name: token.name,
          },
        }),
        ...(!token.isCard && {
          prodiderUserName: token.emailId,
        }),
        userId: new Types.ObjectId(user.id),
      });

      await this._usersService.attachPaymentMethod(method, user);

      return await this._paymentMethodModel
        .find({
          user: user.id,
        })
        .exec();
    } catch (e) {
      console.log('🚀 ~ BillingService ~ savePaypalPaymentMethod ~ e:', e);
      throw new HttpException(
        e?.reponse?.data ?? e,
        e.reponse?.status ?? e.status ?? 500,
        {
          cause: new Error(e?.reponse?.data ?? e),
        },
      );
    }
  }

  async deletePaypalPaymentMethod(id: string, user: UserModel): Promise<void> {
    try {
      // TODO should check payment provider
      //! TODO should check if payment method is default ??
      const method = await this._paymentMethodModel.findOne({
        _id: new Types.ObjectId(id),
      });
      if (!method) {
        throw new NotFoundException('payment_method_not_found');
      }

      await this._usersService.detachPaymentMethod(method, user);

      const response = await this._paypalService.deletePaymentMethod(
        method.providerId,
        user,
      );
      console.log(
        '🚀 ~ BillingService ~ deletePaypalPaymentMethod ~ response:',
        response,
      );
      await this._paymentMethodModel
        .deleteOne({
          _id: new Types.ObjectId(id),
          user: user.id,
        })
        .exec();
    } catch (e) {
      console.log('🚀 ~ BillingService ~ deletePaypalPaymentMethod ~ e:', e);
      throw new HttpException(
        e?.reponse?.data ?? e,
        e.reponse?.status ?? e.status ?? 500,
        {
          cause: new Error(e?.reponse?.data ?? e),
        },
      );
    }
  }

  async listStripeBalanceTransactionsForVendor(
    user: UserModel,
    opts: { storeId?: string; limit?: number; startingAfter?: string },
  ) {
    if (user.type !== UserTypeEnum.VENDOR) {
      throw new ForbiddenException('vendor_only');
    }

    if (!this._stripeConnectService.isConfigured()) {
      return {
        configured: false,
        stripeLinked: false,
        stores: [] as Array<{ id: string; name: string }>,
        transactions: [] as Array<Record<string, unknown>>,
        hasMore: false,
      };
    }

    const vendorIds = vendorStoreObjectIds(user);
    if (!vendorIds.length) {
      return {
        configured: true,
        stripeLinked: false,
        stores: [],
        transactions: [],
        hasMore: false,
      };
    }

    const stores = await this._storeModel
      .find({ _id: { $in: vendorIds } })
      .select('_id name email stripeConnectAccountId')
      .lean()
      .exec();

    const normalized: LeanStoreBilling[] = stores.map((s) => ({
      _id:
        s._id instanceof Types.ObjectId
          ? s._id
          : new Types.ObjectId(String(s._id)),
      name: s.name,
      email: s.email,
      stripeConnectAccountId: s.stripeConnectAccountId,
    }));

    const withStripe = normalized.filter((s) =>
      String(s.stripeConnectAccountId || '').trim(),
    );

    if (!withStripe.length) {
      return {
        configured: true,
        stripeLinked: false,
        stores: normalized.map((s) => ({
          id: s._id.toString(),
          name: s.name || '',
        })),
        transactions: [],
        hasMore: false,
      };
    }

    const target = this.pickVendorStore(withStripe, vendorIds, opts.storeId);

    const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
    const list = await this._stripeConnectService.listBalanceTransactions(
      target.stripeConnectAccountId,
      { limit, startingAfter: opts.startingAfter },
    );

    return {
      configured: true,
      stripeLinked: true,
      storeId: target._id.toString(),
      storeName: target.name ?? null,
      stripeAccountId: target.stripeConnectAccountId,
      hasMore: list.has_more,
      transactions: list.data.map((bt) => ({
        id: bt.id,
        amount: bt.amount,
        currency: bt.currency,
        net: bt.net,
        fee: bt.fee,
        type: bt.type,
        status: bt.status,
        description: bt.description ?? null,
        created: bt.created,
      })),
    };
  }

  /**
   * Crée (si besoin) un compte Stripe Connect Express et renvoie l’URL d’onboarding hébergée par Stripe.
   */
  async startStripeConnectOnboarding(
    user: UserModel,
    body: { storeId?: string },
  ): Promise<{
    completed: boolean;
    url?: string;
    storeId: string;
    accountId?: string;
  }> {
    if (user.type !== UserTypeEnum.VENDOR) {
      throw new ForbiddenException('vendor_only');
    }
    if (!this._stripeConnectService.isConfigured()) {
      throw new ServiceUnavailableException('stripe_not_configured');
    }
    const dashboardBase =
      this._config.get<string>('DASHBOARD_BASE_URL')?.trim() ||
      // Fallback business (évite dashboard_base_url_missing en prod multi-portail).
      resolvePortalAppBaseUrl({
        getEnv: (key) => this._config.get<string>(key),
        audience: 'business',
      });
    if (!dashboardBase) {
      throw new BadRequestException('dashboard_base_url_missing');
    }

    try {
      const vendorIds = vendorStoreObjectIds(user);
      if (!vendorIds.length) {
        throw new BadRequestException('no_store');
      }

      const stores = await this._storeModel
        .find({ _id: { $in: vendorIds } })
        .select('_id name email stripeConnectAccountId')
        .lean()
        .exec();

      const normalized: LeanStoreBilling[] = stores.map((s) => ({
        _id:
          s._id instanceof Types.ObjectId
            ? s._id
            : new Types.ObjectId(String(s._id)),
        name: s.name,
        email: s.email,
        stripeConnectAccountId: s.stripeConnectAccountId,
      }));

      const target = this.pickVendorStore(normalized, vendorIds, body.storeId);

      const populated = await this._storeModel
        .findById(target._id)
        .populate<{ countryCode?: string }>('address', 'country_code')
        .lean()
        .exec();
      if (!populated) {
        throw new NotFoundException('store_not_found');
      }

      const addr = populated.address as
        | { countryCode?: string }
        | Types.ObjectId
        | null
        | undefined;
      const countryFromAddr =
        addr && typeof addr === 'object' && 'countryCode' in addr
          ? String((addr as { countryCode?: string }).countryCode || '')
              .trim()
              .toUpperCase()
              .slice(0, 2)
          : '';
      const fallbackCountry = (
        this._config.get<string>('STRIPE_CONNECT_DEFAULT_COUNTRY') || 'CA'
      )
        .trim()
        .toUpperCase()
        .slice(0, 2);
      const fromUser = String(user.appCountryCode || '')
        .trim()
        .toUpperCase()
        .slice(0, 2);
      const country =
        countryFromAddr.length === 2
          ? countryFromAddr
          : fromUser.length === 2
          ? fromUser
          : fallbackCountry;

      let accountId = String(target.stripeConnectAccountId || '').trim();

      if (accountId) {
        const acc = await this._stripeConnectService.retrieveAccount(accountId);
        if (acc.details_submitted && acc.charges_enabled) {
          return {
            completed: true,
            storeId: target._id.toString(),
            accountId,
          };
        }
      } else {
        const email = String(populated.email || user.email || '').trim();
        if (!email) {
          throw new BadRequestException('store_email_required');
        }
        const brand = String(populated.name || '').trim() || 'Restaurant';
        const created = await this._stripeConnectService.createExpressAccount({
          email,
          country,
          businessName: brand,
        });
        accountId = created.id;
        await this._storeModel.updateOne(
          { _id: target._id },
          { $set: { stripeConnectAccountId: accountId } },
        );
      }

      const base = dashboardBase.replace(/\/+$/, '');
      const sid = target._id.toString();
      const refreshUrl = `${base}/settings/billing/onboarding?storeId=${encodeURIComponent(
        sid,
      )}`;
      const returnUrl = `${base}/settings/billing/onboarding/return`;

      const link = await this._stripeConnectService.createAccountOnboardingLink(
        accountId,
        refreshUrl,
        returnUrl,
      );

      return {
        completed: false,
        url: link.url,
        storeId: sid,
        accountId,
      };
    } catch (e) {
      if (
        e instanceof BadRequestException ||
        e instanceof ForbiddenException ||
        e instanceof NotFoundException ||
        e instanceof ServiceUnavailableException
      ) {
        throw e;
      }
      if (e instanceof Stripe.errors.StripeError) {
        throw new BadRequestException(e.message || 'stripe_error');
      }
      throw e;
    }
  }

  private pickVendorStore(
    candidates: LeanStoreBilling[],
    vendorIds: Types.ObjectId[],
    storeId?: string,
  ): LeanStoreBilling {
    if (!candidates.length) {
      throw new BadRequestException('no_store');
    }
    if (storeId) {
      let sid: Types.ObjectId;
      try {
        sid = new Types.ObjectId(storeId);
      } catch {
        throw new BadRequestException('invalid_store_id');
      }
      if (!vendorIds.some((id) => id.equals(sid))) {
        throw new ForbiddenException('store_not_owned');
      }
      const found = candidates.find((s) => s._id.equals(sid));
      if (!found) {
        throw new NotFoundException('store_not_found');
      }
      return found;
    }
    if (candidates.length === 1) {
      return candidates[0];
    }
    throw new BadRequestException('store_id_required');
  }
}
