import { AdModerationStatusEnum } from '@schemas/ad.schema';

/** Filtre Mongo : exclut les entrées bloquées par modération admin. */
export function catalogModerationNotBlockedFilter(): Record<string, unknown> {
  return {
    $or: [
      { moderationStatus: { $exists: false } },
      { moderationStatus: null },
      { moderationStatus: { $ne: AdModerationStatusEnum.BLOCKED } },
    ],
  };
}

export function moderationStatusFromDoc(
  doc: Record<string, unknown>,
): AdModerationStatusEnum {
  const raw = String(doc.moderationStatus ?? doc.moderation_status ?? '')
    .trim()
    .toUpperCase();
  if (raw === AdModerationStatusEnum.PENDING_REVIEW) {
    return AdModerationStatusEnum.PENDING_REVIEW;
  }
  if (raw === AdModerationStatusEnum.REJECTED) {
    return AdModerationStatusEnum.REJECTED;
  }
  if (raw === AdModerationStatusEnum.BLOCKED) {
    return AdModerationStatusEnum.BLOCKED;
  }
  return AdModerationStatusEnum.APPROVED;
}

export function moderationFieldsFromDoc(doc: Record<string, unknown>): {
  moderationStatus: AdModerationStatusEnum;
  moderationBlockReason: string | null;
  moderationReviewedAt: string | null;
} {
  const reasonRaw = doc.moderationBlockReason ?? doc.moderation_block_reason;
  const reviewedRaw = doc.moderationReviewedAt ?? doc.moderation_reviewed_at;
  return {
    moderationStatus: moderationStatusFromDoc(doc),
    moderationBlockReason:
      typeof reasonRaw === 'string' && reasonRaw.trim()
        ? reasonRaw.trim()
        : null,
    moderationReviewedAt:
      reviewedRaw instanceof Date ? reviewedRaw.toISOString() : null,
  };
}
