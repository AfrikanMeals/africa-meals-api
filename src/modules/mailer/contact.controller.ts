import { Body, Controller, HttpCode, Post, ValidationPipe } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { ContactDto } from './dto/contact.dto';
import { MailerService } from './mailer.service';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

@ApiTags('contact')
@Controller('contact')
export class ContactController {
  constructor(
    private readonly mailerService: MailerService,
    private readonly configService: ConfigService,
  ) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Formulaire de contact du site vitrine (envoi SMTP / MailerSend)',
  })
  async sendContactMessage(@Body(ValidationPipe) body: ContactDto) {
    if (body.website?.trim()) {
      return {
        success: true,
        message: 'Message reçu.',
      };
    }

    const appName = this.configService.get<string>('APP_NAME')?.trim() || 'Wise Eat';
    const to =
      this.configService.get<string>('SUPPORT_EMAIL')?.trim() ||
      this.configService.get<string>('SMTP_FROM')?.trim() ||
      'contact@wiseeat.com';
    const name = body.name.trim();
    const email = body.email.trim().toLowerCase();
    const subject =
      body.subject?.trim() || `Contact ${appName} — ${name}`.slice(0, 200);
    const message = body.message.trim();
    const safeName = escapeHtml(name);
    const safeEmail = escapeHtml(email);
    const safeSubject = escapeHtml(subject);
    const safeMessage = escapeHtml(message).replace(/\n/g, '<br>');

    await this.mailerService.sendSimple({
      to,
      toName: appName,
      subject: `[Contact] ${subject}`,
      html: `
        <h2>Nouveau message — site ${escapeHtml(appName)}</h2>
        <p><strong>Nom :</strong> ${safeName}</p>
        <p><strong>E-mail :</strong> <a href="mailto:${safeEmail}">${safeEmail}</a></p>
        <p><strong>Sujet :</strong> ${safeSubject}</p>
        <hr>
        <p>${safeMessage}</p>
      `.trim(),
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

    return {
      success: true,
      message: 'Votre message a été envoyé. Nous vous répondrons sous peu.',
    };
  }
}
