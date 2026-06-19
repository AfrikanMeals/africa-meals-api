import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  VendorGuideArticleModel,
  VendorGuideArticleSchema,
  VendorGuideProgressModel,
  VendorGuideProgressSchema,
  VendorGuideSettingsModel,
  VendorGuideSettingsSchema,
} from '@schemas/vendor-guide.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import { TeamsModule } from '@modules/teams/teams.module';
import { VendorGuidesController } from './vendor-guides.controller';
import { VendorGuidesService } from './vendor-guides.service';

@Module({
  imports: [
    TeamsModule,
    MongooseModule.forFeature([
      { name: VendorGuideArticleModel.name, schema: VendorGuideArticleSchema },
      { name: VendorGuideSettingsModel.name, schema: VendorGuideSettingsSchema },
      { name: VendorGuideProgressModel.name, schema: VendorGuideProgressSchema },
      { name: StoreModel.name, schema: StoreSchema },
    ]),
  ],
  controllers: [VendorGuidesController],
  providers: [VendorGuidesService],
  exports: [VendorGuidesService],
})
export class VendorGuidesModule {}
