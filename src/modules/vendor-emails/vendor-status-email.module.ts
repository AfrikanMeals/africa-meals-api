import { MailerModule } from '@modules/mailer/mailer.module';
import { MobileAppSettingsModule } from '@modules/mobile-app-settings/mobile-app-settings.module';
import { VendorNotificationModule } from '@modules/vendor-notifications/vendor-notification.module';
import { TeamsModule } from '@modules/teams/teams.module';
import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import { UserModel, UserSchema } from '@schemas/user.schema';
import { VendorStatusEmailService } from './vendor-status-email.service';
import { PartnerOnboardingEmailService } from './partner-onboarding-email.service';

@Module({
  imports: [
    MailerModule,
    MobileAppSettingsModule,
    forwardRef(() => TeamsModule),
    forwardRef(() => VendorNotificationModule),
    MongooseModule.forFeature([
      { name: UserModel.name, schema: UserSchema },
      { name: StoreModel.name, schema: StoreSchema },
    ]),
  ],
  providers: [VendorStatusEmailService, PartnerOnboardingEmailService],
  exports: [VendorStatusEmailService, PartnerOnboardingEmailService],
})
export class VendorStatusEmailModule {}
