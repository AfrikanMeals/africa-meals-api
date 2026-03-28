import { AuthModule } from '@modules/auth/auth.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  SupportChatMessageModel,
  SupportChatMessageSchema,
} from '@schemas/support-chat.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import { UserModel, UserSchema } from '@schemas/user.schema';
import { SupportChatController } from './support-chat.controller';
import { SupportChatService } from './support-chat.service';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: SupportChatMessageModel.name, schema: SupportChatMessageSchema },
      { name: UserModel.name, schema: UserSchema },
      { name: StoreModel.name, schema: StoreSchema },
    ]),
  ],
  controllers: [SupportChatController],
  providers: [SupportChatService],
  exports: [SupportChatService],
})
export class SupportChatModule {}
