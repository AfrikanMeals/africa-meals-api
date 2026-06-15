import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { SharedModule } from '@modules/shared/shared.module';
import {
  SecuritySettingsModel,
  SecuritySettingsSchema,
} from '@schemas/security-settings.schema';
import { AppCheckGuard } from './app-check.guard';
import { AppCheckService } from './app-check.service';
import { SecuritySettingsController } from './security-settings.controller';
import { SecuritySettingsService } from './security-settings.service';

@Module({
  imports: [
    SharedModule,
    MongooseModule.forFeature([
      { name: SecuritySettingsModel.name, schema: SecuritySettingsSchema },
    ]),
  ],
  controllers: [SecuritySettingsController],
  providers: [
    SecuritySettingsService,
    AppCheckService,
    {
      provide: APP_GUARD,
      useClass: AppCheckGuard,
    },
  ],
  exports: [SecuritySettingsService, AppCheckService],
})
export class SecuritySettingsModule {}
