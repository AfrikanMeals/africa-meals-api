import {
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { PartnerAffiliationEarningsService } from '@modules/partner-subscriptions/partner-affiliation-earnings.service';
import {
  buildPartnerDashboardSummary,
  isPartnerDashboardInboxType,
  type PartnerDashboardSummaryDto,
} from '@modules/partner-subscriptions/partner-dashboard-summary.util';
import { PartnerSubscriptionsService } from '@modules/partner-subscriptions/partner-subscriptions.service';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { PartnerPaymentsService } from './partner-payments.service';

/**
 * Agrège earnings / referrers / abonnement / Connect / inbox → dashboard Partner.
 */
@Injectable()
export class PartnerDashboardService {
  private readonly logger = new Logger(PartnerDashboardService.name);

  constructor(
    private readonly affiliation: PartnerAffiliationEarningsService,
    private readonly subscriptions: PartnerSubscriptionsService,
    private readonly payments: PartnerPaymentsService,
    private readonly notifications: NotificationsService,
  ) {}

  private assertPartner(user: UserModel) {
    if (user.type !== UserTypeEnum.PARTNER) {
      throw new ForbiddenException('partner_dashboard_partner_only');
    }
  }

  async getDashboard(user: UserModel): Promise<PartnerDashboardSummaryDto> {
    this.assertPartner(user);
    const uid = String(user._id ?? user.id ?? '');

    // 1. Paralléliser les lectures métier (ledger, réseau, sub, Connect).
    const [earnings, referrers, mine, connect] = await Promise.all([
      this.affiliation.listMineForPartner(user),
      this.affiliation.listReferrersForPartner(user),
      this.subscriptions.getMine(user),
      this.payments.getConnectStatus(user).catch((e) => {
        // Connect Stripe indisponible → dashboard reste utilisable.
        this.logger.warn(
          `partner dashboard connect status failed: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
        return {
          chargesEnabled: false,
          payoutsEnabled: false,
          onboardingComplete: false,
        };
      }),
    ]);

    // 2. Inbox Partner (filtre types côté util) — best-effort.
    let inbox: {
      id: string;
      type?: string;
      title?: string;
      body?: string;
      createdAt?: string | null;
    }[] = [];
    try {
      const feed = await this.notifications.listInboxForUser({
        userId: uid,
        limit: 24,
      });
      inbox = feed.items
        .filter((row) => isPartnerDashboardInboxType(row.type))
        .slice(0, 8)
        .map((row) => ({
          id: row.id,
          type: row.type,
          title: row.title,
          body: row.body,
          createdAt: row.createdAt,
        }));
    } catch (e) {
      this.logger.warn(
        `partner dashboard inbox failed: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }

    return buildPartnerDashboardSummary({
      earningsItems: earnings.items,
      earningsTotals: earnings.totals,
      referrersBundle: referrers,
      subscriptionActive: mine.active,
      connectStatus: connect,
      inbox,
    });
  }
}
