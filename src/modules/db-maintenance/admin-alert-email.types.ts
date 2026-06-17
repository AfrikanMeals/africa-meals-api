export type AdminAlertRecipient = {
  email: string;
  name: string;
};

export type AdminAlertEmailBatchJob = {
  campaignId: string;
  batchIndex: number;
  batchTotal: number;
  subject: string;
  htmlBody: string;
  recipients: AdminAlertRecipient[];
  initiatedByUserId: string;
};
