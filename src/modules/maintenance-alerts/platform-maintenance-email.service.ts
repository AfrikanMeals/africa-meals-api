import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailerService } from '@modules/mailer/mailer.service';
import { MaintenancePlatformEnum } from '@schemas/platform-maintenance.schema';
import {
  buildMaintenanceModeEmail,
  resolveMaintenanceModeHeroUrl,
} from './platform-maintenance-email.util';

@Injectable()
export class PlatformMaintenanceEmailService {
  private readonly logger = new Logger(PlatformMaintenanceEmailService.name);

  constructor(
    private readonly mailer: MailerService,
    private readonly config: ConfigService,
  ) {}

  async sendToggleNotification(args: {
    recipients: string[];
    platform: MaintenancePlatformEnum;
    enabled: boolean;
    message: string;
    actorEmail: string;
    toggledAt: Date;
  }): Promise<void> {
    if (!args.recipients.length) {
      this.logger.debug('Platform maintenance email skipped: no recipients');
      return;
    }

    const appName =
      this.config.get<string>('APP_NAME')?.trim() || 'Wise Eat';
    const toggledAt = args.toggledAt.toISOString();
    const content = buildMaintenanceModeEmail({
      appName,
      platform: args.platform,
      enabled: args.enabled,
      message: args.message,
      actorEmail: args.actorEmail,
      toggledAt,
    });
    const heroImageUrl = resolveMaintenanceModeHeroUrl({
      config: this.config,
      enabled: args.enabled,
    });

    for (const to of args.recipients) {
      try {
        await this.mailer.sendSimple({
          to,
          subject: content.subject,
          html: content.html,
          text: content.text,
          heroImageUrl,
          heroImageAlt: content.heroImageAlt,
          logContext: 'platform-maintenance-toggle',
        });
      } catch (e) {
        this.logger.warn(
          `Platform maintenance email to ${to}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }
}
