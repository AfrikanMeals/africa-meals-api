import { MediasModule } from '@modules/medias/medias.module';
import { OffersModule } from '@modules/offers/offers.module';
import { ProductsModule } from '@modules/products/products.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
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
    ProductsModule,
    OffersModule,
    MediasModule,
    MongooseModule.forFeature([
      { name: AnnouncementModel.name, schema: AnnouncementSchema },
    ]),
  ],
  exports: [AnnouncementsService],
})
export class AnnouncementsModule {}
