import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import {
  SiteContactRequestMailStatusEnum,
  SiteContactRequestModel,
} from '@schemas/site-contact-request.schema';
import { Model } from 'mongoose';
import { ContactDto } from './dto/contact.dto';
import { EmailTemplateService } from './email-template.service';
import { MailerService } from './mailer.service';

@Injectable()
export class ContactSubmissionService {
  private readonly logger = new Logger(ContactSubmissionService.name);

  constructor(
    @InjectModel(SiteContactRequestModel.name)
    private readonly siteContactRequestModel: Model<SiteContactRequestModel>,
    private readonly mailerService: MailerService,
    private readonly configService: ConfigService,
    private readonly emailTpl: EmailTemplateService,
  ) {}

  async submit(body: ContactDto): Promise<{ success: boolean; message: string }> {
    const appName =
      this.configService.get<string>('APP_NAME')?.trim() || 'Wise Eat';
    const name = body.name.trim();
    const email = body.email.trim().toLowerCase();
    const subject =
      body.subject?.trim() || `Contact ${appName} — ${name}`.slice(0, 200);
    const message = body.message.trim();

    const doc = await this.siteContactRequestModel.create({
      name,
      email,
      subject,
      message,
      mailStatus: SiteContactRequestMailStatusEnum.PENDING,
    });

    try {
      await this.sendContactEmail({ appName, name, email, subject, message });
      await this.siteContactRequestModel.updateOne(
        { _id: doc._id },
        {
          mailStatus: SiteContactRequestMailStatusEnum.SENT,
          mailError: '',
        },
      );
    } catch (e) {
      const errMsg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      await this.siteContactRequestModel.updateOne(
        { _id: doc._id },
        {
          mailStatus: SiteContactRequestMailStatusEnum.FAILED,
          mailError: errMsg,
        },
      );
      this.logger.error(
        `Contact mail failed for ${String(doc._id)}: ${errMsg}`,
      );
    }

    return {
      success: true,
      message: 'Votre message a été envoyé. Nous vous répondrons sous peu.',
    };
  }

  private async sendContactEmail(args: {
    appName: string;
    name: string;
    email: string;
    subject: string;
    message: string;
  }): Promise<void> {
    const { appName, name, email, subject, message } = args;
    const to =
      this.configService.get<string>('SUPPORT_EMAIL')?.trim() ||
      this.configService.get<string>('SMTP_FROM')?.trim() ||
      'contact@wiseeat.com';
    const safeName = this.emailTpl.escapeHtml(name);
    const safeEmail = this.emailTpl.escapeHtml(email);
    const safeSubject = this.emailTpl.escapeHtml(subject);
    const safeMessage = this.emailTpl.escapeHtml(message).replace(/\n/g, '<br>');
    const safeApp = this.emailTpl.escapeHtml(appName);

    await this.mailerService.sendSimple({
      to,
      toName: appName,
      subject: `[Contact] ${subject}`,
      html: [
        this.emailTpl.heading(`Nouveau message — ${safeApp}`),
        this.emailTpl.keyValues([
          { label: 'Nom', value: safeName },
          {
            label: 'E-mail',
            value: `<a href="mailto:${safeEmail}" style="color:#aa6900;text-decoration:none;">${safeEmail}</a>`,
          },
          { label: 'Sujet', value: safeSubject },
        ]),
        this.emailTpl.divider(),
        this.emailTpl.infoPanel(this.emailTpl.paragraph(safeMessage)),
      ].join('\n'),
      text: [
        `Nouveau message — site ${appName}`,
        `Nom : ${name}`,
        `E-mail : ${email}`,
        `Sujet : ${subject}`,
        '',
        message,
      ].join('\n'),
      replyTo: email,
      replyToName: name,
    });
  }

  async sendContactReply(args: {
    name: string;
    email: string;
    subject: string;
    message: string;
    createdAt: Date;
    replyMessage: string;
    replySubject?: string;
  }): Promise<void> {
    const appName =
      this.configService.get<string>('APP_NAME')?.trim() || 'Wise Eat';
    const supportEmail =
      this.configService.get<string>('SUPPORT_EMAIL')?.trim() ||
      this.configService.get<string>('SMTP_FROM')?.trim() ||
      'help@wise-eat.com';

    const { name, email, subject, message, createdAt, replyMessage } = args;
    const replySubject = this.buildReplySubject(appName, subject, args.replySubject);
    const safeReply = this.emailTpl.escapeHtml(replyMessage.trim()).replace(
      /\n/g,
      '<br>',
    );
    const safeOriginal = this.emailTpl.escapeHtml(message).replace(/\n/g, '<br>');
    const safeApp = this.emailTpl.escapeHtml(appName);
    const sentAt = createdAt.toLocaleString('fr-CA', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'America/Toronto',
    });

    const html = [
      this.emailTpl.heading('Réponse à votre message'),
      this.emailTpl.paragraph(safeReply),
      this.emailTpl.divider(),
      this.emailTpl.muted(
        `Pour rappel, voici votre message envoyé le ${this.emailTpl.escapeHtml(sentAt)} via le formulaire de contact ${safeApp} :`,
      ),
      this.emailTpl.infoPanel(this.emailTpl.paragraph(safeOriginal)),
      subject
        ? this.emailTpl.muted(
            `Sujet initial : ${this.emailTpl.escapeHtml(subject)}`,
          )
        : '',
      this.emailTpl.muted(
        'Vous pouvez répondre directement à cet e-mail pour poursuivre la conversation avec notre équipe.',
      ),
    ]
      .filter(Boolean)
      .join('\n');

    const text = [
      replyMessage.trim(),
      '',
      '—',
      `Votre message du ${sentAt} :`,
      message,
      subject ? `Sujet : ${subject}` : null,
      '',
      'Répondez à cet e-mail pour nous recontacter.',
      '',
      `L’équipe ${appName}`,
      supportEmail,
    ]
      .filter((line): line is string => line !== null)
      .join('\n');

    await this.mailerService.sendSimple({
      to: email,
      toName: name,
      subject: replySubject,
      html,
      text,
      replyTo: supportEmail,
      replyToName: appName,
      logContext: 'site-contact-reply',
    });
  }

  private buildReplySubject(
    appName: string,
    originalSubject: string,
    override?: string,
  ): string {
    const custom = override?.trim();
    if (custom) return custom.slice(0, 200);
    const base = originalSubject.trim() || 'Votre message';
    if (/^\[.+\]\s/i.test(base)) {
      return `Re: ${base}`.slice(0, 200);
    }
    return `[${appName}] Re: ${base}`.slice(0, 200);
  }
}
