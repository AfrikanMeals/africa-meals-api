import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  AuthSettingsModel,
  AuthSettingsSchema,
} from '@schemas/auth-settings.schema';
import { AuthSettingsController } from './auth-settings.controller';
import { AuthSettingsService } from './auth-settings.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AuthSettingsModel.name, schema: AuthSettingsSchema },
    ]),
    AuthModule,
  ],
  controllers: [AuthSettingsController],
  providers: [AuthSettingsService],
  exports: [AuthSettingsService],
})
export class AuthSettingsModule {}
