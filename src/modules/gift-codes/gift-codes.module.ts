import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GiftCodeModel, GiftCodeSchema } from '@schemas/gift_code.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import { TeamsModule } from '@modules/teams/teams.module';
import { SupportedCountriesModule } from '@modules/supported-countries/supported-countries.module';
import { MailerModule } from '@modules/mailer/mailer.module';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { WsNotifyModule } from '@modules/ws-notify/ws-notify.module';
import { UserModel, UserSchema } from '@schemas/user.schema';
import { GiftCodesController } from './gift-codes.controller';
import { GiftCodesService } from './gift-codes.service';
import { GiftCodeActivationNotifierService } from './gift-code-activation-notifier.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: GiftCodeModel.name, schema: GiftCodeSchema },
      { name: StoreModel.name, schema: StoreSchema },
      { name: UserModel.name, schema: UserSchema },
    ]),
    TeamsModule,
    SupportedCountriesModule,
    MailerModule,
    NotificationsModule,
    WsNotifyModule,
  ],
  controllers: [GiftCodesController],
  providers: [GiftCodesService, GiftCodeActivationNotifierService],
  exports: [GiftCodesService],
})
export class GiftCodesModule {}
