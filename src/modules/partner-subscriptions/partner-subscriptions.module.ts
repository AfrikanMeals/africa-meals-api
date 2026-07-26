import { CronMonitorModule } from '@modules/cron-monitor/cron-monitor.module';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { SupportedCountriesModule } from '@modules/supported-countries/supported-countries.module';
import { VendorStatusEmailModule } from '@modules/vendor-emails/vendor-status-email.module';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PartnerApplicationModel,
  PartnerApplicationSchema,
} from '@schemas/partner-application.schema';
import {
  PartnerEarningModel,
  PartnerEarningSchema,
} from '@schemas/partner-earning.schema';
import {
  PartnerSubscriptionPlanModel,
  PartnerSubscriptionPlanSchema,
} from '@schemas/partner-subscription-plan.schema';
import {
  PartnerSubscriptionModel,
  PartnerSubscriptionSchema,
} from '@schemas/partner-subscription.schema';
import { UserModel, UserSchema } from '@schemas/user.schema';
import { PartnerAffiliationEarningsService } from './partner-affiliation-earnings.service';
import { PartnerSubscriptionPlansAdminController } from './partner-subscription-plans-admin.controller';
import { PartnerSubscriptionPlansService } from './partner-subscription-plans.service';
import { PartnerSubscriptionTrialReminderCron } from './partner-subscription-trial-reminder.cron';
import { PartnerSubscriptionTrialReminderService } from './partner-subscription-trial-reminder.service';
import { PartnerSubscriptionsAdminController } from './partner-subscriptions-admin.controller';
import { PartnerSubscriptionsController } from './partner-subscriptions.controller';
import { PartnerSubscriptionsService } from './partner-subscriptions.service';

@Module({
  imports: [
    ConfigModule,
    CronMonitorModule,
    NotificationsModule,
    // E-mails cycle de vie abonnement Partner.
    VendorStatusEmailModule,
    // Facteur Stripe Régions (XAF montants entiers / CAD centimes).
    SupportedCountriesModule,
    MongooseModule.forFeature([
      {
        name: PartnerSubscriptionPlanModel.name,
        schema: PartnerSubscriptionPlanSchema,
      },
      {
        name: PartnerSubscriptionModel.name,
        schema: PartnerSubscriptionSchema,
      },
      { name: PartnerEarningModel.name, schema: PartnerEarningSchema },
      {
        name: PartnerApplicationModel.name,
        schema: PartnerApplicationSchema,
      },
      { name: UserModel.name, schema: UserSchema },
    ]),
  ],
  controllers: [
    PartnerSubscriptionPlansAdminController,
    PartnerSubscriptionsAdminController,
    PartnerSubscriptionsController,
  ],
  providers: [
    PartnerSubscriptionPlansService,
    PartnerSubscriptionsService,
    PartnerAffiliationEarningsService,
    PartnerSubscriptionTrialReminderService,
    PartnerSubscriptionTrialReminderCron,
  ],
  exports: [
    PartnerSubscriptionPlansService,
    PartnerSubscriptionsService,
    PartnerAffiliationEarningsService,
  ],
})
export class PartnerSubscriptionsModule {}
