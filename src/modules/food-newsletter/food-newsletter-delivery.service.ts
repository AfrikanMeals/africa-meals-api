import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import {
  emailHeading,
  emailParagraph,
  emailPrimaryButton,
  EmailTemplateService,
} from '@modules/mailer/email-template.service';
import { MailerService } from '@modules/mailer/mailer.service';
import { EngagementPerformancesService } from '@modules/engagement-performances/engagement-performances.service';
import {
  EngagementPerformanceChannel,
  EngagementPerformanceEventType,
} from '@schemas/engagement-performance-event.schema';
import {
  FoodNewsletterCandidateDocument,
  FoodNewsletterCandidateModel,
} from '@schemas/food-newsletter-candidate.schema';
import {
  FoodNewsletterScheduleDocument,
  FoodNewsletterScheduleModel,
  FoodNewsletterScheduleStatus,
} from '@schemas/food-newsletter-schedule.schema';
import { Model } from 'mongoose';
import {
  issueFoodNewsletterToken,
  resolveFoodNewsletterSigningSecret,
} from './food-newsletter-track-token.util';

@Injectable()
export class FoodNewsletterDeliveryService {
  private readonly logger = new Logger(FoodNewsletterDeliveryService.name);

  constructor(
    @InjectModel(FoodNewsletterScheduleModel.name)
    private readonly scheduleModel: Model<FoodNewsletterScheduleDocument>,
    @InjectModel(FoodNewsletterCandidateModel.name)
    private readonly candidateModel: Model<FoodNewsletterCandidateDocument>,
    private readonly mailer: MailerService,
    private readonly emailTpl: EmailTemplateService,
    private readonly config: ConfigService,
    private readonly performances: EngagementPerformancesService,
  ) {}

  private apiBaseUrl(): string {
    return (
      this.config.get<string>('API_PUBLIC_BASE_URL')?.trim() ||
      this.config.get<string>('API_BASE_URL')?.trim() ||
      'http://localhost:3000'
    ).replace(/\/$/, '');
  }

  private webBaseUrl(): string {
    return (
      this.config.get<string>('PUBLIC_WEB_URL')?.trim() ||
      this.config.get<string>('WEBSITE_URL')?.trim() ||
      'https://wise-eat.com'
    ).replace(/\/$/, '');
  }

  private buildHtml(
    schedule: FoodNewsletterScheduleDocument,
    snapshot: Record<string, unknown>,
    ctaUrl: string,
    unsubscribeUrl: string,
    openPixelUrl: string,
  ): string {
    const copy = schedule.copy ?? {};
    const stores = (snapshot.stores as Array<Record<string, unknown>>) ?? [];
    const items = (snapshot.items as Array<Record<string, unknown>>) ?? [];
    const esc = (v: string) => this.emailTpl.escapeHtml(v);

    let body = emailHeading(String(copy.heroLine ?? copy.subject ?? 'Wise Eat'));
    body += emailParagraph(String(copy.intro ?? ''));

    if (stores.length > 0) {
      body += emailHeading('Vos boutiques', 3);
      for (const store of stores.slice(0, 3)) {
        body += emailParagraph(
          `<strong>${esc(String(store.name ?? ''))}</strong> — ${esc(String(store.highlight ?? ''))}`,
        );
      }
    }

    if (items.length > 0) {
      body += emailHeading('Pour vous', 3);
      for (const item of items.slice(0, 4)) {
        body += emailParagraph(
          `${esc(String(item.title ?? ''))} · ${esc(String(item.storeName ?? ''))}`,
        );
      }
    }

    body += emailPrimaryButton(String(copy.cta ?? 'Voir le menu'), ctaUrl);
    body += emailParagraph(
      `<a href="${esc(unsubscribeUrl)}" style="color:#888;font-size:12px">Se désabonner</a>`,
    );
    body += `<img src="${esc(openPixelUrl)}" width="1" height="1" alt="" style="display:none" />`;
    return body;
  }

  async deliverSchedule(
    schedule: FoodNewsletterScheduleDocument,
    candidate: FoodNewsletterCandidateDocument,
  ): Promise<void> {
    const userId = String(schedule.userId);
    const scheduleId = String(schedule._id);
    const campaignId = schedule.campaignId || `wise_eat_newsletter_${scheduleId}`;
    const secret = resolveFoodNewsletterSigningSecret(this.config);
    const token = issueFoodNewsletterToken(scheduleId, secret);
    const api = this.apiBaseUrl();
    const web = this.webBaseUrl();

    const ctaUrl = `${api}/food-newsletter/r/${scheduleId}?c=cta&utm_source=wise_eat_newsletter&token=${encodeURIComponent(token)}`;
    const unsubscribeUrl = `${api}/food-newsletter/unsubscribe?scheduleId=${scheduleId}&token=${encodeURIComponent(token)}`;
    const openPixelUrl = `${api}/food-newsletter/o/${scheduleId}.gif?token=${encodeURIComponent(token)}`;

    const snapshot = (schedule.contentSnapshot ??
      candidate.contentSnapshot ??
      {}) as Record<string, unknown>;
    const html = this.buildHtml(schedule, snapshot, ctaUrl, unsubscribeUrl, openPixelUrl);
    const wrapped = await this.emailTpl.wrapBodyAsync(html, {
      title: String(schedule.copy?.subject ?? 'Wise Eat'),
      preheader: String(schedule.copy?.preheader ?? ''),
    });

    await this.mailer.sendSimple({
      to: schedule.email,
      subject: String(schedule.copy?.subject ?? 'Wise Eat — vos recommandations'),
      html: wrapped,
      text: String(schedule.copy?.intro ?? ''),
      emailModule: 'newsletter',
      logContext: 'food-newsletter-delivery',
    });

    const sentAt = new Date();
    await this.scheduleModel.updateOne(
      { _id: schedule._id },
      { $set: { status: FoodNewsletterScheduleStatus.SENT, sentAt } },
    );
    await this.candidateModel.updateOne(
      { _id: candidate._id },
      { $set: { sentAt } },
    );

    await this.performances.recordEvent({
      channel: EngagementPerformanceChannel.EMAIL_NEWSLETTER,
      event: EngagementPerformanceEventType.SENT,
      userId,
      scheduleId,
      campaignId,
      candidateType: candidate.campaignType,
      copySource: schedule.copy?.source ?? 'template',
      region: candidate.region ?? '',
    });
    await this.performances.recordEvent({
      channel: EngagementPerformanceChannel.EMAIL_NEWSLETTER,
      event: EngagementPerformanceEventType.DELIVERED,
      userId,
      scheduleId,
      campaignId,
      candidateType: candidate.campaignType,
    });
  }
}
