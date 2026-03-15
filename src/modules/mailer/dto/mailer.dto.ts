export class SendMailDto {
  to: string;
  toName?: string;
  subject: string;
  /** Ignored when using SMTP (Gmail); HTML is built from context. */
  templateId?: string;
  context: Record<string, any>;
}
