import {
  bucketFcmPlatform,
  buildFcmApnsOptions,
} from './fcm-apns-payload.util';

describe('buildFcmApnsOptions', () => {
  it('bannière : aps.alert + apns-push-type alert (visible iOS)', () => {
    const apns = buildFcmApnsOptions({
      mode: 'banner',
      title: 'Offre',
      body: 'Hello',
    });
    expect(apns.headers['apns-push-type']).toBe('alert');
    expect(apns.payload.aps.alert).toEqual({ title: 'Offre', body: 'Hello' });
    expect(apns.payload.aps.contentAvailable).toBeUndefined();
    expect(apns.fcmOptions).toBeUndefined();
  });

  it('bannière avec image : mutableContent, pas sans image', () => {
    const withImg = buildFcmApnsOptions({
      mode: 'banner',
      title: 'T',
      body: 'B',
      imageUrl: 'https://cdn.example/a.png',
    });
    expect(withImg.payload.aps.mutableContent).toBe(true);
    expect(withImg.fcmOptions?.imageUrl).toContain('https://');
    const plain = buildFcmApnsOptions({ mode: 'banner', title: 'T', body: 'B' });
    expect(plain.payload.aps.mutableContent).toBeUndefined();
  });

  it('dataOnly reste silencieux sans alert', () => {
    const apns = buildFcmApnsOptions({
      mode: 'silent',
      title: 'T',
      body: 'B',
    });
    expect(apns.payload.aps.alert).toBeUndefined();
    expect(apns.payload.aps.contentAvailable).toBe(true);
    expect(apns.headers['apns-push-type']).toBeUndefined();
  });

  it('call-like garde alert + contentAvailable, sans push-type ajouté', () => {
    const apns = buildFcmApnsOptions({
      mode: 'callLike',
      title: 'Cours',
      body: 'Nouvelle',
    });
    expect(apns.payload.aps.alert).toEqual({
      title: 'Cours',
      body: 'Nouvelle',
    });
    expect(apns.payload.aps.contentAvailable).toBe(true);
    expect(apns.headers['apns-push-type']).toBeUndefined();
  });
});

describe('bucketFcmPlatform', () => {
  it('regroupe ios / android / reste', () => {
    expect(bucketFcmPlatform('iOS')).toBe('ios');
    expect(bucketFcmPlatform('android')).toBe('android');
    expect(bucketFcmPlatform('web')).toBe('other');
    expect(bucketFcmPlatform('')).toBe('other');
  });
});
