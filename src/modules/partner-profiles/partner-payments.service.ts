import {
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { StripeConnectService } from '@modules/billing/stripe/stripe-connect.service';
import { PartnerAffiliationEarningsService } from '@modules/partner-subscriptions/partner-affiliation-earnings.service';
import { normalizePartnerDisplayCurrency } from '@modules/partner-subscriptions/partner-earning-list.util';
import { PartnerSubscriptionPlansService } from '@modules/partner-subscriptions/partner-subscription-plans.service';
import { SupportedCountriesService } from '@modules/supported-countries/supported-countries.service';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';

/**
 * Finance Partenaire — Stripe Connect + liste commissions affiliation.
 * Miroir delivery-agent payments (payouts) + ledger partner_earnings.
 */
@Injectable()
export class PartnerPaymentsService {
  private readonly _logger = new Logger(PartnerPaymentsService.name);

  constructor(
    private readonly _stripeConnect: StripeConnectService,
    private readonly _affiliation: PartnerAffiliationEarningsService,
    private readonly _plans: PartnerSubscriptionPlansService,
    private readonly _supportedCountries: SupportedCountriesService,
  ) {}

  private assertPartner(user: UserModel) {
    if (user.type !== UserTypeEnum.PARTNER) {
      throw new ForbiddenException('partner_payments_partner_only');
    }
  }

  getConnectStatus(user: UserModel) {
    this.assertPartner(user);
    return this._stripeConnect.getConnectStatus(user);
  }

  createOnboardingLink(user: UserModel) {
    this.assertPartner(user);
    this._logger.log(`partner onboarding-link user=${String(user.id ?? '')}`);
    // Même Connect que modes vendeur / livreur (`user.stripeConnectAccountId`).
    return this._stripeConnect.createOnboardingLink(user);
  }

  getConnectBalance(user: UserModel) {
    this.assertPartner(user);
    return this._stripeConnect.getConnectBalance(user);
  }

  getPayoutEstimate(user: UserModel) {
    this.assertPartner(user);
    return this._stripeConnect.getPayoutEstimate(user);
  }

  requestPayout(user: UserModel) {
    this.assertPartner(user);
    return this._stripeConnect.requestPayout(user);
  }

  listPayouts(user: UserModel, limit?: number, startingAfter?: string) {
    this.assertPartner(user);
    return this._stripeConnect.listPayouts(user, limit, startingAfter);
  }

  /** Commissions affiliation (PENDING / TRANSFERRED / FAILED). */
  async listEarnings(user: UserModel) {
    this.assertPartner(user);
    const list = await this._affiliation.listMineForPartner(user);
    // Devise d’affichage = région Partner (conversion Fawaz côté client).
    const pricingRegion = await this._plans.resolvePricingRegionForUser(user);
    const displayCurrency = pricingRegion
      ? await this._supportedCountries.getCountryCurrency(pricingRegion)
      : 'CAD';
    return {
      ...list,
      displayCurrency: normalizePartnerDisplayCurrency(displayCurrency),
      pricingRegion: pricingRegion
        ? String(pricingRegion).trim().toUpperCase()
        : null,
    };
  }
}
