import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  NewsletterSubscriberModel,
  NewsletterSubscriberStatusEnum,
} from '@schemas/newsletter-subscriber.schema';
import { NewsletterSubscribeDto } from './dto/newsletter-subscribe.dto';

@Injectable()
export class NewsletterSubscriptionService {
  constructor(
    @InjectModel(NewsletterSubscriberModel.name)
    private readonly newsletterSubscriberModel: Model<NewsletterSubscriberModel>,
  ) {}

  async subscribe(
    body: NewsletterSubscribeDto,
  ): Promise<{ success: boolean; message: string }> {
    const email = body.email.trim().toLowerCase();
    const locale = body.locale?.trim().slice(0, 10) || '';

    await this.newsletterSubscriberModel.findOneAndUpdate(
      { email },
      {
        $set: {
          email,
          locale,
          source: 'footer',
          status: NewsletterSubscriberStatusEnum.ACTIVE,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    return {
      success: true,
      message:
        'Merci ! Vous êtes inscrit à la newsletter Wise Eat.',
    };
  }
}
