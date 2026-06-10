import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { EmailTemplateService } from '@modules/mailer/email-template.service';
import { MailerService } from '@modules/mailer/mailer.service';
import {
  BlogArticleDocument,
  BlogArticleModel,
} from '@schemas/blog.schema';
import {
  NewsletterSubscriberModel,
  NewsletterSubscriberStatusEnum,
} from '@schemas/newsletter-subscriber.schema';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';
import { BlogNewsletterDispatchQueueService } from './blog-newsletter-dispatch-queue.service';
import type {
  BlogNewsletterBatchJob,
  BlogNewsletterDispatchResult,
  BlogNewsletterRecipient,
} from './blog-newsletter-dispatch.types';

const EMAIL_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

const DEFAULT_BATCH_SIZE = 20;

type EmailCopy = {
  subject: string;
  preheader: string;
  heading: string;
  intro: string;
  cta: string;
  footer: string;
};

@Injectable()
export class BlogNewsletterDispatchService {
  private readonly logger = new Logger(BlogNewsletterDispatchService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly mailer: MailerService,
    private readonly emailTpl: EmailTemplateService,
    @Inject(forwardRef(() => BlogNewsletterDispatchQueueService))
    private readonly queue: BlogNewsletterDispatchQueueService,
    @InjectModel(BlogArticleModel.name)
    private readonly articleModel: Model<BlogArticleDocument>,
    @InjectModel(NewsletterSubscriberModel.name)
    private readonly subscriberModel: Model<NewsletterSubscriberModel>,
  ) {}

  async tryEnqueueForArticle(
    article: BlogArticleDocument,
    options?: { wasPublished?: boolean },
  ): Promise<BlogNewsletterDispatchResult> {
    if (!this.isDispatchEnabled()) {
      return this.skipped('Envoi newsletter désactivé (BLOG_NEWSLETTER_DISPATCH_ENABLED).');
    }

    if (!article.isPublished) {
      return this.skipped('Article non publié.');
    }

    if (options?.wasPublished) {
      return this.skipped('Article déjà publié — newsletter déjà diffusée ou non applicable.');
    }

    const claimed = await this.articleModel
      .findOneAndUpdate(
        {
          _id: article._id,
          isPublished: true,
          $or: [
            { newsletterDispatchedAt: { $exists: false } },
            { newsletterDispatchedAt: null },
          ],
        },
        { $set: { newsletterDispatchedAt: new Date() } },
        { new: true },
      )
      .exec();

    if (!claimed) {
      return this.skipped('Newsletter déjà envoyée pour cet article.');
    }

    const recipients = await this.loadActiveSubscribers();
    if (recipients.length === 0) {
      this.logger.log(
        `blog-newsletter skip article=${article.slug} locale=${article.locale} — aucun abonné actif`,
      );
      return {
        dispatched: false,
        queued: false,
        recipientCount: 0,
        batchCount: 0,
        message: 'Article publié — aucun abonné newsletter actif.',
      };
    }

    const campaignId = randomUUID();
    const articleUrl = this.buildArticleUrl(
      article.groupSlug,
      article.slug,
      article.locale,
    );
    const batches = this.splitBatches({
      campaignId,
      articleId: String(article._id),
      articleSlug: article.slug,
      articleLocale: article.locale,
      groupSlug: article.groupSlug,
      title: article.title.trim(),
      description: this.plainDescription(article.description),
      featuredImageUrl: article.featuredImageUrl?.trim() || undefined,
      articleUrl,
      recipients,
    });

    const { queued, batchCount } = await this.queue.enqueueBatches(batches);

    this.logger.log(
      `blog-newsletter campaign=${campaignId} article=${article.slug} locale=${article.locale} recipients=${recipients.length} batches=${batchCount} queued=${queued}`,
    );

    return {
      dispatched: true,
      queued,
      recipientCount: recipients.length,
      batchCount,
      message: queued
        ? `Newsletter mise en file (${recipients.length} abonné(s), ${batchCount} lot(s)).`
        : `Newsletter envoyée (${recipients.length} abonné(s)).`,
    };
  }

  async processBatchJob(job: BlogNewsletterBatchJob): Promise<void> {
    for (const recipient of job.recipients) {
      const email = recipient.email.trim().toLowerCase();
      if (!email || !EMAIL_RE.test(email)) continue;

      const locale = normalizeSubscriberLocale(recipient.locale);
      const copy = emailCopy(locale, job.title);
      const html = this.buildEmailHtml(job, copy);

      try {
        await this.mailer.sendSimple({
          to: email,
          toName: email.split('@')[0],
          subject: copy.subject,
          html,
          logContext: `blog-newsletter:${job.campaignId}:${job.articleSlug}`,
        });
      } catch (err) {
        this.logger.warn(
          `blog-newsletter send failed campaign=${job.campaignId} article=${job.articleSlug} to=${email}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  private isDispatchEnabled(): boolean {
    const raw = this.config
      .get<string>('BLOG_NEWSLETTER_DISPATCH_ENABLED')
      ?.trim()
      .toLowerCase();
    if (raw === '0' || raw === 'false' || raw === 'no') return false;
    return true;
  }

  private skipped(message: string): BlogNewsletterDispatchResult {
    return {
      dispatched: false,
      queued: false,
      recipientCount: 0,
      batchCount: 0,
      message,
    };
  }

  private batchSize(): number {
    const raw = this.config.get<string>('BLOG_NEWSLETTER_BATCH_SIZE')?.trim();
    const n = raw ? parseInt(raw, 10) : DEFAULT_BATCH_SIZE;
    return Number.isFinite(n) && n > 0 ? Math.min(n, 100) : DEFAULT_BATCH_SIZE;
  }

  private webBaseUrl(): string {
    return (
      this.config.get<string>('PUBLIC_WEB_URL')?.trim() ||
      this.config.get<string>('EMAIL_WEBSITE_URL')?.trim() ||
      this.config.get<string>('WEBSITE_URL')?.trim() ||
      'https://wise-eat.com'
    ).replace(/\/$/, '');
  }

  private buildArticleUrl(
    groupSlug: string,
    articleSlug: string,
    articleLocale: string,
  ): string {
    const url = new URL('/blog', this.webBaseUrl());
    url.searchParams.set('group', groupSlug);
    url.searchParams.set('article', articleSlug);
    if (articleLocale === 'en') {
      url.searchParams.set('lang', 'en');
    }
    return url.toString();
  }

  private plainDescription(raw: string | undefined): string {
    const text = String(raw ?? '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text.slice(0, 500);
  }

  private async loadActiveSubscribers(): Promise<BlogNewsletterRecipient[]> {
    const rows = await this.subscriberModel
      .find({ status: NewsletterSubscriberStatusEnum.ACTIVE })
      .select({ email: 1, locale: 1 })
      .lean()
      .exec();

    const seen = new Set<string>();
    const out: BlogNewsletterRecipient[] = [];
    for (const row of rows) {
      const email = String(row.email ?? '')
        .trim()
        .toLowerCase();
      if (!email || !EMAIL_RE.test(email) || seen.has(email)) continue;
      seen.add(email);
      out.push({
        email,
        locale: String(row.locale ?? '').trim().slice(0, 10),
      });
    }
    return out;
  }

  private splitBatches(
    base: Omit<BlogNewsletterBatchJob, 'recipients'> & {
      recipients: BlogNewsletterRecipient[];
    },
  ): BlogNewsletterBatchJob[] {
    const size = this.batchSize();
    const out: BlogNewsletterBatchJob[] = [];
    for (let i = 0; i < base.recipients.length; i += size) {
      out.push({
        ...base,
        recipients: base.recipients.slice(i, i + size),
      });
    }
    return out;
  }

  private buildEmailHtml(job: BlogNewsletterBatchJob, copy: EmailCopy): string {
    const esc = this.emailTpl.escapeHtml.bind(this.emailTpl);
    const title = esc(job.title);
    const description = job.description ? esc(job.description) : '';
    const parts = [
      this.emailTpl.heading(copy.heading, 1),
      this.emailTpl.paragraph(copy.intro),
      this.emailTpl.heading(title, 2),
    ];

    if (description) {
      parts.push(this.emailTpl.muted(description));
    }

    if (job.featuredImageUrl) {
      const imgUrl = esc(job.featuredImageUrl);
      parts.push(
        `<p style="margin:0 0 16px;"><img src="${imgUrl}" alt="${title}" width="560" style="max-width:100%;height:auto;border-radius:12px;display:block;" /></p>`,
      );
    }

    parts.push(
      this.emailTpl.button(copy.cta, job.articleUrl),
      this.emailTpl.divider(),
      this.emailTpl.muted(copy.footer),
    );

    return parts.join('\n');
  }
}

function normalizeSubscriberLocale(raw: string): 'fr' | 'en' {
  return raw.trim().toLowerCase().startsWith('en') ? 'en' : 'fr';
}

function emailCopy(locale: 'fr' | 'en', title: string): EmailCopy {
  const safeTitle = title.trim();
  if (locale === 'en') {
    return {
      subject: `Wise Eat — New article: ${safeTitle}`,
      preheader: safeTitle,
      heading: 'New on the Wise Eat blog',
      intro: 'We just published a new article you might enjoy:',
      cta: 'Read the article',
      footer:
        'You receive this email because you subscribed to the Wise Eat newsletter.',
    };
  }
  return {
    subject: `Wise Eat — Nouvel article : ${safeTitle}`,
    preheader: safeTitle,
    heading: 'Nouveau sur le blog Wise Eat',
    intro: 'Nous venons de publier un nouvel article qui pourrait vous intéresser :',
    cta: "Lire l'article",
    footer:
      'Vous recevez cet e-mail car vous êtes inscrit à la newsletter Wise Eat.',
  };
}
