import { TeamsModule } from '@modules/teams/teams.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  UserUsageSessionModel,
  UserUsageSessionSchema,
} from '@schemas/user-usage-session.schema';
import { UserModel, UserSchema } from '@schemas/user.schema';
import { UsageTimeController } from './usage-time.controller';
import { UsageTimeService } from './usage-time.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: UserUsageSessionModel.name, schema: UserUsageSessionSchema },
      { name: UserModel.name, schema: UserSchema },
    ]),
    TeamsModule,
  ],
  controllers: [UsageTimeController],
  providers: [UsageTimeService],
  exports: [UsageTimeService],
})
export class UsageTimeModule {}
