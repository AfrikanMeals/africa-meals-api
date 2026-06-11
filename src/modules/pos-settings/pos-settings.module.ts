import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PosLicensePlanModel,
  PosLicensePlanSchema,
} from '@schemas/pos-license-plan.schema';
import {
  PosSettingsModel,
  PosSettingsSchema,
} from '@schemas/pos-settings.schema';
import {
  PosVendorLicenseModel,
  PosVendorLicenseSchema,
} from '@schemas/pos-vendor-license.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import { PlatformPosController } from './platform-pos.controller';
import { PosManageController } from './pos-manage.controller';
import { PosSettingsService } from './pos-settings.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PosSettingsModel.name, schema: PosSettingsSchema },
      { name: PosLicensePlanModel.name, schema: PosLicensePlanSchema },
      { name: PosVendorLicenseModel.name, schema: PosVendorLicenseSchema },
      { name: StoreModel.name, schema: StoreSchema },
    ]),
  ],
  controllers: [PlatformPosController, PosManageController],
  providers: [PosSettingsService],
  exports: [PosSettingsService],
})
export class PosSettingsModule {}
