import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PlatformRoleModel,
  PlatformRoleSchema,
} from '@schemas/platform-role.schema';
import {
  StoreMemberModel,
  StoreMemberSchema,
} from '@schemas/store-member.schema';
import { StoreRoleModel, StoreRoleSchema } from '@schemas/store-role.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import { UserModel, UserSchema } from '@schemas/user.schema';
import { StoreAccessService } from './store-access.service';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';
import { SubscriptionsModule } from '@modules/subscriptions/subscriptions.module';

@Module({
  imports: [
    SubscriptionsModule,
    MongooseModule.forFeature([
      { name: StoreModel.name, schema: StoreSchema },
      { name: StoreRoleModel.name, schema: StoreRoleSchema },
      { name: StoreMemberModel.name, schema: StoreMemberSchema },
      { name: PlatformRoleModel.name, schema: PlatformRoleSchema },
      { name: UserModel.name, schema: UserSchema },
    ]),
  ],
  controllers: [TeamsController],
  providers: [TeamsService, StoreAccessService],
  exports: [TeamsService, StoreAccessService],
})
export class TeamsModule {}
