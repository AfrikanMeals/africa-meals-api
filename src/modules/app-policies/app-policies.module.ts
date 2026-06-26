import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AppPolicyModel, AppPolicySchema } from '@schemas/app-policy.schema';
import {
  PlatformLegalSettingsModel,
  PlatformLegalSettingsSchema,
} from '@schemas/platform-legal-settings.schema';
import {
  MobileAppSettingsModel,
  MobileAppSettingsSchema,
} from '@schemas/mobile-app-settings.schema';
import { MediasModule } from '@modules/medias/medias.module';
import { AppPoliciesController } from './app-policies.controller';
import { AppPoliciesService } from './app-policies.service';
import { PlatformLegalSettingsService } from './platform-legal-settings.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AppPolicyModel.name, schema: AppPolicySchema },
      {
        name: PlatformLegalSettingsModel.name,
        schema: PlatformLegalSettingsSchema,
      },
      { name: MobileAppSettingsModel.name, schema: MobileAppSettingsSchema },
    ]),
    MediasModule,
  ],
  controllers: [AppPoliciesController],
  providers: [AppPoliciesService, PlatformLegalSettingsService],
  exports: [AppPoliciesService, PlatformLegalSettingsService],
})
export class AppPoliciesModule {}
