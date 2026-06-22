import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SubscriptionsModule } from '@modules/subscriptions/subscriptions.module';
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

/** Accès boutique / permissions — isolé pour éviter la dépendance circulaire Teams ↔ SupportedCountries. */
@Module({
  imports: [
    forwardRef(() => SubscriptionsModule),
    MongooseModule.forFeature([
      { name: StoreModel.name, schema: StoreSchema },
      { name: StoreRoleModel.name, schema: StoreRoleSchema },
      { name: StoreMemberModel.name, schema: StoreMemberSchema },
      { name: PlatformRoleModel.name, schema: PlatformRoleSchema },
      { name: UserModel.name, schema: UserSchema },
    ]),
  ],
  providers: [StoreAccessService],
  exports: [StoreAccessService],
})
export class StoreAccessModule {}
