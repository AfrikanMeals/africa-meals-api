import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  CacheSettingsModel,
  CacheSettingsSchema,
} from '@schemas/cache-settings.schema';
import { TeamsModule } from '@modules/teams/teams.module';
import { CacheSettingsController } from './cache-settings.controller';
import { CacheSettingsService } from './cache-settings.service';

@Module({
  imports: [
    TeamsModule,
    MongooseModule.forFeature([
      { name: CacheSettingsModel.name, schema: CacheSettingsSchema },
    ]),
  ],
  controllers: [CacheSettingsController],
  providers: [CacheSettingsService],
  exports: [CacheSettingsService],
})
export class CacheSettingsModule {}
