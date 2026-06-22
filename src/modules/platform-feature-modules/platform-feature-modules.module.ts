import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PlatformFeatureModulesModel,
  PlatformFeatureModulesSchema,
} from '@schemas/platform-feature-modules.schema';
import { PlatformFeatureModulesController } from './platform-feature-modules.controller';
import { PlatformFeatureModulesService } from './platform-feature-modules.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: PlatformFeatureModulesModel.name,
        schema: PlatformFeatureModulesSchema,
      },
    ]),
  ],
  controllers: [PlatformFeatureModulesController],
  providers: [PlatformFeatureModulesService],
  exports: [PlatformFeatureModulesService],
})
export class PlatformFeatureModulesModule {}
