export type FcmApnsMode = 'silent' | 'callLike' | 'banner';

export type FcmPlatformBucket = 'ios' | 'android' | 'other';

export type FcmPlatformCounts = Record<FcmPlatformBucket, number>;

/** Compteurs vides (jetons absents ou pas encore envoyés). */
export function emptyFcmPlatformCounts(): FcmPlatformCounts {
  return { ios: 0, android: 0, other: 0 };
}

/**
 * Classe un jeton FCM (`fcm_tokens.platform`). Pas de version d’OS en base.
 */
export function bucketFcmPlatform(raw: unknown): FcmPlatformBucket {
  const platform = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (platform === 'ios' || platform === 'iphone' || platform === 'ipad') {
    return 'ios';
  }
  if (platform === 'android') return 'android';
  return 'other';
}

/**
 * Payload APNs pour `sendMulticastNotification`.
 * Bannière : `aps.alert` obligatoire — un `aps` custom sans alert + contentAvailable
 * est un push silencieux et iOS n’affiche rien (Android a `android.notification`).
 */
export function buildFcmApnsOptions(args: {
  mode: FcmApnsMode;
  title: string;
  body: string;
  imageUrl?: string;
}): {
  headers: Record<string, string>;
  fcmOptions?: { imageUrl: string };
  payload: { aps: Record<string, unknown> };
} {
  if (args.mode === 'silent') {
    return {
      headers: { 'apns-priority': '10' },
      payload: { aps: { contentAvailable: true } },
    };
  }
  if (args.mode === 'callLike') {
    return {
      headers: { 'apns-priority': '10' },
      payload: {
        aps: {
          alert: { title: args.title, body: args.body },
          sound: 'default',
          contentAvailable: true,
        },
      },
    };
  }
  const imageUrl = args.imageUrl?.trim() || undefined;
  return {
    headers: {
      'apns-priority': '10',
      // iOS 13+ : sans ce type, un payload mixte peut être rejeté ou silencieux.
      'apns-push-type': 'alert',
    },
    ...(imageUrl ? { fcmOptions: { imageUrl } } : {}),
    payload: {
      aps: {
        alert: { title: args.title, body: args.body },
        sound: 'default',
        ...(imageUrl ? { mutableContent: true } : {}),
      },
    },
  };
}
