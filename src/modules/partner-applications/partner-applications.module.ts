import { PartnerSubscriptionsModule } from '@modules/partner-subscriptions/partner-subscriptions.module';
import { SupportedCountriesModule } from '@modules/supported-countries/supported-countries.module';
import { VendorStatusEmailModule } from '@modules/vendor-emails/vendor-status-email.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PartnerApplicationModel,
  PartnerApplicationSchema,
} from '@schemas/partner-application.schema';
import { UserModel, UserSchema } from '@schemas/user.schema';
import { PartnerApplicationsController } from './partner-applications.controller';
import { PartnerApplicationsService } from './partner-applications.service';

@Module({
  imports: [
    SupportedCountriesModule,
    // E-mails approve / reject candidature partenaire.
    VendorStatusEmailModule,
    // Assignation plan FREE par défaut à l’approbation / réactivation.
    PartnerSubscriptionsModule,
    MongooseModule.forFeature([
      {
        name: PartnerApplicationModel.name,
        schema: PartnerApplicationSchema,
      },
      { name: UserModel.name, schema: UserSchema },
    ]),
  ],
  controllers: [PartnerApplicationsController],
  providers: [PartnerApplicationsService],
  exports: [PartnerApplicationsService],
})
export class PartnerApplicationsModule {}
