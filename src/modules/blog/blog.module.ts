import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  BlogArticleModel,
  BlogArticleSchema,
  BlogGroupModel,
  BlogGroupSchema,
} from '@schemas/blog.schema';
import {
  NewsletterSubscriberModel,
  NewsletterSubscriberSchema,
} from '@schemas/newsletter-subscriber.schema';
import { MailerModule } from '../mailer/mailer.module';
import { MediasModule } from '../medias/medias.module';
import { BlogController } from './blog.controller';
import { BlogNewsletterDispatchQueueService } from './blog-newsletter-dispatch-queue.service';
import { BlogNewsletterDispatchService } from './blog-newsletter-dispatch.service';
import { BlogService } from './blog.service';

@Module({
  imports: [
    MailerModule,
    MediasModule,
    MongooseModule.forFeature([
      { name: BlogGroupModel.name, schema: BlogGroupSchema },
      { name: BlogArticleModel.name, schema: BlogArticleSchema },
      {
        name: NewsletterSubscriberModel.name,
        schema: NewsletterSubscriberSchema,
      },
    ]),
  ],
  controllers: [BlogController],
  providers: [
    BlogService,
    BlogNewsletterDispatchService,
    BlogNewsletterDispatchQueueService,
  ],
  exports: [BlogService],
})
export class BlogModule {}
