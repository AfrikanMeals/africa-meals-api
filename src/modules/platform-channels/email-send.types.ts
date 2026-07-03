import type { EmailAppModuleId } from './email-module.registry';

export type MailAttachment = {
  filename: string;
  content: Buffer;
  contentType?: string;
};

export type SmtpSendProfile = {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  fromDisplayName: string;
  secure?: boolean;
};

export type DispatchSimpleMailPayload = {
  to: string;
  toName?: string;
  cc?: string[];
  /** Copie cachée (ex. Trustpilot Automatic Feedback Service). */
  bcc?: string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  replyToName?: string;
  attachments?: MailAttachment[];
  logContext?: string;
};

export type EmailEngineRuntimeContext = {
  globalEngine: string;
  defaultSmtpConfigured: boolean;
  birdEmailConfigured: boolean;
  resendConfigured: boolean;
  sendgridConfigured: boolean;
  configuredSmtpConfigIds: string[];
  mailerSendConfigured: boolean;
};
