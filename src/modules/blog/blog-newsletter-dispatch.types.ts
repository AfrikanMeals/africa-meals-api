export type BlogNewsletterRecipient = {
  email: string;
  locale: string;
};

export type BlogNewsletterBatchJob = {
  campaignId: string;
  articleId: string;
  articleSlug: string;
  articleLocale: string;
  groupSlug: string;
  title: string;
  description: string;
  featuredImageUrl?: string;
  articleUrl: string;
  recipients: BlogNewsletterRecipient[];
};

export type BlogNewsletterDispatchResult = {
  dispatched: boolean;
  queued: boolean;
  recipientCount: number;
  batchCount: number;
  message: string;
};
