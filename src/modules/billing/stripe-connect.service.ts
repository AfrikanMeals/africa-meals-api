import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

type StripeClient = InstanceType<typeof Stripe>;

@Injectable()
export class StripeConnectService {
  private readonly stripe: StripeClient | null;

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
  ) {
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
  }) {
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

  async retrieveAccount(accountId: string) {
    if (!this.stripe) {
      throw new ServiceUnavailableException('stripe_not_configured');
    }
    return this.stripe.accounts.retrieve(accountId);
  }

  async createAccountOnboardingLink(
    accountId: string,
    refreshUrl: string,
    returnUrl: string,
  ) {
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
