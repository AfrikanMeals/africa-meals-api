import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PartnerProfileModel,
  PartnerProfileSchema,
} from '@schemas/partner-profile.schema';
import { UserModel, UserSchema } from '@schemas/user.schema';
import { BillingModule } from '@modules/billing/billing.module';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { PartnerApplicationsModule } from '@modules/partner-applications/partner-applications.module';
import { PartnerSubscriptionsModule } from '@modules/partner-subscriptions/partner-subscriptions.module';
import { SupportedCountriesModule } from '@modules/supported-countries/supported-countries.module';
import { VendorStatusEmailModule } from '@modules/vendor-emails/vendor-status-email.module';
import { PartnerProfilesController } from './partner-profiles.controller';
import { PartnerProfilesAdminController } from './partner-profiles-admin.controller';
import { PartnerProfilesService } from './partner-profiles.service';
import { PartnerPaymentsController } from './partner-payments.controller';
import { PartnerPaymentsService } from './partner-payments.service';
import { PartnerDashboardController } from './partner-dashboard.controller';
import { PartnerDashboardService } from './partner-dashboard.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: PartnerProfileModel.name,
        schema: PartnerProfileSchema,
      },
      // Jointure compte pour liste admin fiches.
      { name: UserModel.name, schema: UserSchema },
    ]),
    // Mail de confirmation à la 1ʳᵉ soumission de fiche.
    VendorStatusEmailModule,
    // Inbox + FCM revue fiche (approve / reject / suspend / reactivate).
    NotificationsModule,
    // Stripe Connect finance partenaire.
    BillingModule,
    // Ledger commissions affiliation (GET partner/payments/earnings).
    PartnerSubscriptionsModule,
    // Devise région Partner (dashboard / earnings displayCurrency).
    SupportedCountriesModule,
    // Allocation / lecture codes referral (partner_applications).
    PartnerApplicationsModule,
  ],
  controllers: [
    PartnerProfilesController,
    PartnerProfilesAdminController,
    PartnerPaymentsController,
    // Agrégat KPI Accueil Partner (mobile + admin).
    PartnerDashboardController,
  ],
  providers: [
    PartnerProfilesService,
    PartnerPaymentsService,
    PartnerDashboardService,
  ],
  exports: [PartnerProfilesService, PartnerPaymentsService],
})
export class PartnerProfilesModule {}
