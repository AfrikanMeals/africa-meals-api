export class SendMailDto {
  to: string;
  toName?: string;
  subject: string;
  templateId: string;
  context: Record<string, any>;
}
