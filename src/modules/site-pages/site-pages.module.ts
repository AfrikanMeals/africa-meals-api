import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SitePageModel, SitePageSchema } from '@schemas/site-page.schema';
import { SitePagesController } from './site-pages.controller';
import { SitePagesService } from './site-pages.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SitePageModel.name, schema: SitePageSchema },
    ]),
  ],
  controllers: [SitePagesController],
  providers: [SitePagesService],
  exports: [SitePagesService],
})
export class SitePagesModule {}
