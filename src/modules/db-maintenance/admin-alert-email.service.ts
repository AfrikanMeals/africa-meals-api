import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { EmailTemplateService } from '@modules/mailer/email-template.service';
import { MailerService } from '@modules/mailer/mailer.service';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model } from 'mongoose';
import {
  AdminAlertAudience,
  AdminAlertAudienceQueryDto,
  SendAdminAlertEmailDto,
} from './dto/send-admin-alert-email.dto';
import { DbMaintenanceService } from './db-maintenance.service';
import { AdminAlertEmailQueueService } from './admin-alert-email-queue.service';
import { AdminJobEmitterService } from '@modules/admin-jobs/admin-job-emitter.service';
import type {
  AdminAlertEmailBatchJob,
  AdminAlertRecipient,
} from './admin-alert-email.types';
import { randomUUID } from 'crypto';

const EMAIL_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

const BATCH_SIZE = 20;

@Injectable()
export class AdminAlertEmailService {
  private readonly logger = new Logger(AdminAlertEmailService.name);

  constructor(
    private readonly dbMaintenance: DbMaintenanceService,
    private readonly mailer: MailerService,
    private readonly emailTpl: EmailTemplateService,
    @Inject(forwardRef(() => AdminAlertEmailQueueService))
    private readonly queue: AdminAlertEmailQueueService,
    @Inject(forwardRef(() => AdminJobEmitterService))
    private readonly jobEmitter: AdminJobEmitterService,
    @InjectModel(UserModel.name)
    private readonly userModel: Model<UserModel>,
  ) {}

  async countAudience(
    user: UserModel,
    query: AdminAlertAudienceQueryDto,
  ): Promise<{ audience: AdminAlertAudience; recipientCount: number }> {
    await this.dbMaintenance.assertAdminSettingsPermission(user);
    const recipients = await this.resolveRecipients(query);
    return { audience: query.audience, recipientCount: recipients.length };
  }

  async enqueueCampaign(
    user: UserModel,
    dto: SendAdminAlertEmailDto,
  ): Promise<{
    jobId: string;
    campaignId: string;
    audience: AdminAlertAudience;
    recipientCount: number;
    batchCount: number;
    queued: boolean;
    message: string;
  }> {
    await this.dbMaintenance.assertAdminSettingsPermission(user);

    const subject = dto.subject.trim();
    const htmlBody = dto.htmlBody.trim();
    if (!subject || !htmlBody) {
      throw new BadRequestException('subject_and_body_required');
    }

    const recipients = await this.resolveRecipients(dto);
    if (recipients.length === 0) {
      throw new BadRequestException('no_recipients');
    }

    const campaignId = randomUUID();
    const batches = this.splitBatches({
      campaignId,
      subject,
      htmlBody,
      recipients,
      initiatedByUserId: String(user._id ?? user.id),
    });

    const { queued, batchCount } = await this.queue.enqueueBatches(batches);

    await this.jobEmitter.emitProgress({
      jobId: campaignId,
      pct: 0,
      label: queued ? 'Mise en file…' : 'Envoi…',
      phase: 'start',
    });

    this.logger.log(
      `Admin alert email campaign=${campaignId} audience=${dto.audience} recipients=${recipients.length} batches=${batchCount} queued=${queued} by=${user.id}`,
    );

    return {
      jobId: campaignId,
      campaignId,
      audience: dto.audience,
      recipientCount: recipients.length,
      batchCount,
      queued,
      message: queued
        ? `Envoi mis en file (${recipientCountLabel(recipients.length)}, ${batchCount} lot(s)).`
        : `Envoi terminé (${recipientCountLabel(recipients.length)}).`,
    };
  }

  async processBatchJob(job: AdminAlertEmailBatchJob): Promise<void> {
    const subject = job.subject.trim();
    const htmlBody = job.htmlBody.trim();
    const html = [
      this.emailTpl.heading(subject),
      htmlBody,
    ].join('\n');
    for (const r of job.recipients) {
      const email = r.email.trim().toLowerCase();
      if (!email || !EMAIL_RE.test(email)) continue;
      try {
        await this.mailer.sendSimple({
          to: email,
          toName: r.name.trim() || email,
          subject,
          html,
          logContext: `admin-alert:${job.campaignId}`,
        });
      } catch (err) {
        this.logger.warn(
          `admin-alert send failed campaign=${job.campaignId} to=${email}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  private splitBatches(
    base: Omit<AdminAlertEmailBatchJob, 'recipients' | 'batchIndex' | 'batchTotal'> & {
      recipients: AdminAlertRecipient[];
    },
  ): AdminAlertEmailBatchJob[] {
    const out: AdminAlertEmailBatchJob[] = [];
    const batchTotal = Math.max(1, Math.ceil(base.recipients.length / BATCH_SIZE));
    for (let i = 0; i < base.recipients.length; i += BATCH_SIZE) {
      out.push({
        ...base,
        batchIndex: out.length,
        batchTotal,
        recipients: base.recipients.slice(i, i + BATCH_SIZE),
      });
    }
    return out;
  }

  private async resolveRecipients(
    input: AdminAlertAudienceQueryDto | SendAdminAlertEmailDto,
  ): Promise<AdminAlertRecipient[]> {
    if (input.audience === AdminAlertAudience.CUSTOM) {
      return this.parseCustomEmails(input.customEmails ?? '');
    }

    const type = audienceToUserType(input.audience);
    const rows = await this.userModel
      .find({ type })
      .select({ email: 1, fullName: 1 })
      .lean()
      .exec();

    const seen = new Set<string>();
    const out: AdminAlertRecipient[] = [];
    for (const row of rows) {
      const email = String(row.email ?? '')
        .trim()
        .toLowerCase();
      if (!email || !EMAIL_RE.test(email) || seen.has(email)) continue;
      seen.add(email);
      const name = String(row.fullName ?? '').trim() || email.split('@')[0];
      out.push({ email, name });
    }
    return out;
  }

  private parseCustomEmails(raw: string): AdminAlertRecipient[] {
    const parts = raw
      .split(/[\s,;]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const seen = new Set<string>();
    const out: AdminAlertRecipient[] = [];
    for (const email of parts) {
      if (!EMAIL_RE.test(email) || seen.has(email)) continue;
      seen.add(email);
      out.push({ email, name: email.split('@')[0] });
    }
    return out;
  }
}

function audienceToUserType(audience: AdminAlertAudience): UserTypeEnum {
  switch (audience) {
    case AdminAlertAudience.ALL_VENDORS:
      return UserTypeEnum.VENDOR;
    case AdminAlertAudience.ALL_DELIVERY_AGENTS:
      return UserTypeEnum.DELIVERY;
    case AdminAlertAudience.ALL_CUSTOMERS:
      return UserTypeEnum.USER;
    default:
      throw new BadRequestException('invalid_audience');
  }
}

function recipientCountLabel(n: number): string {
  return n === 1 ? '1 destinataire' : `${n} destinataires`;
}
