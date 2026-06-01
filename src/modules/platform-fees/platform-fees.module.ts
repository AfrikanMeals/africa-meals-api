import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PlatformFeesSettingsModel,
  PlatformFeesSettingsSchema,
} from '@schemas/platform-fees-settings.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import { PlatformFeesController } from './platform-fees.controller';
import { PlatformFeesService } from './platform-fees.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: PlatformFeesSettingsModel.name,
        schema: PlatformFeesSettingsSchema,
      },
      {
        name: StoreModel.name,
        schema: StoreSchema,
      },
    ]),
  ],
  controllers: [PlatformFeesController],
  providers: [PlatformFeesService],
  exports: [PlatformFeesService],
})
export class PlatformFeesModule {}
