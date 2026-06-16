import { BillingModule } from '@modules/billing/billing.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PartnerBadgeModel,
  PartnerBadgeSchema,
} from '@schemas/partner-badge.schema';
import { PartnerBadgesController } from './partner-badges.controller';
import { PartnerBadgesService } from './partner-badges.service';

@Module({
  imports: [
    BillingModule,
    MongooseModule.forFeature([
      { name: PartnerBadgeModel.name, schema: PartnerBadgeSchema },
    ]),
  ],
  controllers: [PartnerBadgesController],
  providers: [PartnerBadgesService],
  exports: [PartnerBadgesService],
})
export class PartnerBadgesModule {}
