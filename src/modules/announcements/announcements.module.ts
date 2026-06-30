import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MediasModule } from '@modules/medias/medias.module';
import {
  AnnouncementDismissalModel,
  AnnouncementDismissalSchema,
} from '@schemas/announcement-dismissal.schema';
import {
  AnnouncementModel,
  AnnouncementSchema,
} from '@schemas/announcement.schema';
import { AnnouncementsController } from './announcements.controller';
import { AnnouncementsService } from './announcements.service';

@Module({
  controllers: [AnnouncementsController],
  providers: [AnnouncementsService],
  imports: [
    MediasModule,
    MongooseModule.forFeature([
      { name: AnnouncementModel.name, schema: AnnouncementSchema },
      {
        name: AnnouncementDismissalModel.name,
        schema: AnnouncementDismissalSchema,
      },
    ]),
  ],
  exports: [AnnouncementsService],
})
export class AnnouncementsModule {}
