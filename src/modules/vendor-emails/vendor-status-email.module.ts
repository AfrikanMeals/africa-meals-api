import { MailerModule } from '@modules/mailer/mailer.module';
import { TeamsModule } from '@modules/teams/teams.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import { UserModel, UserSchema } from '@schemas/user.schema';
import { VendorStatusEmailService } from './vendor-status-email.service';

@Module({
  imports: [
    MailerModule,
    TeamsModule,
    MongooseModule.forFeature([
      { name: UserModel.name, schema: UserSchema },
      { name: StoreModel.name, schema: StoreSchema },
    ]),
  ],
  providers: [VendorStatusEmailService],
  exports: [VendorStatusEmailService],
})
export class VendorStatusEmailModule {}
