import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AppPolicyModel, AppPolicySchema } from '@schemas/app-policy.schema';
import { MediasModule } from '@modules/medias/medias.module';
import { AppPoliciesController } from './app-policies.controller';
import { AppPoliciesService } from './app-policies.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AppPolicyModel.name, schema: AppPolicySchema },
    ]),
    MediasModule,
  ],
  controllers: [AppPoliciesController],
  providers: [AppPoliciesService],
  exports: [AppPoliciesService],
})
export class AppPoliciesModule {}
