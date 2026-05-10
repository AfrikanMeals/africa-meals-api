import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

@Injectable()
export class StripeConnectService {
  private readonly stripe: Stripe | null;

  constructor(private readonly _config: ConfigService) {
    const key = this._config.get<string>('STRIPE_SECRET_KEY')?.trim();
    this.stripe = key ? new Stripe(key) : null;
  }

  isConfigured(): boolean {
    return this.stripe !== null;
  }

  async listBalanceTransactions(
    connectedAccountId: string,
    opts: { limit: number; startingAfter?: string },
  ): Promise<Stripe.Response<Stripe.ApiList<Stripe.BalanceTransaction>>> {
    if (!this.stripe) {
      throw new ServiceUnavailableException('stripe_not_configured');
    }
    return this.stripe.balanceTransactions.list(
      {
        limit: opts.limit,
        ...(opts.startingAfter
          ? { starting_after: opts.startingAfter }
          : {}),
      },
      { stripeAccount: connectedAccountId },
    );
  }

  async createExpressAccount(params: {
    email: string;
    country: string;
    businessName: string;
  }): Promise<Stripe.Response<Stripe.Account>> {
    if (!this.stripe) {
      throw new ServiceUnavailableException('stripe_not_configured');
    }
    return this.stripe.accounts.create({
      type: 'express',
      country: params.country.toUpperCase(),
      email: params.email,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      business_profile: {
        name: params.businessName,
      },
    });
  }

  async retrieveAccount(accountId: string): Promise<Stripe.Response<Stripe.Account>> {
    if (!this.stripe) {
      throw new ServiceUnavailableException('stripe_not_configured');
    }
    return this.stripe.accounts.retrieve(accountId);
  }

  async createAccountOnboardingLink(
    accountId: string,
    refreshUrl: string,
    returnUrl: string,
  ): Promise<Stripe.Response<Stripe.AccountLink>> {
    if (!this.stripe) {
      throw new ServiceUnavailableException('stripe_not_configured');
    }
    return this.stripe.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    });
  }
}
