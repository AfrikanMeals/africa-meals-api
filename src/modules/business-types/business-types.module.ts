import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PlatformBusinessTypesModel,
  PlatformBusinessTypesSchema,
} from '@schemas/platform-business-types.schema';
import { BusinessTypesController } from './business-types.controller';
import { BusinessTypesService } from './business-types.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: PlatformBusinessTypesModel.name,
        schema: PlatformBusinessTypesSchema,
      },
    ]),
  ],
  controllers: [BusinessTypesController],
  providers: [BusinessTypesService],
  exports: [BusinessTypesService],
})
export class BusinessTypesModule {}
