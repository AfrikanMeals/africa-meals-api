export type AdminAlertRecipient = {
  email: string;
  name: string;
};

export type AdminAlertEmailBatchJob = {
  campaignId: string;
  subject: string;
  htmlBody: string;
  recipients: AdminAlertRecipient[];
  initiatedByUserId: string;
};
