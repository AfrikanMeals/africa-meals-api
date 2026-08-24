import { resolveStoreOrderNotifyPushFanout } from './vendor-notification-dispatch-recipients.util';

describe('resolveStoreOrderNotifyPushFanout', () => {
  const team = ['team-1', 'owner-1'];
  const admins = ['admin-1', 'admin-2'];

  it('push ON → partition équipe (vendor) vs admins (admin), hors client', () => {
    const out = resolveStoreOrderNotifyPushFanout({
      storeTeamIds: [...team, 'cust-1'],
      platformAdminIds: admins,
      customerUserId: 'cust-1',
      storePushEnabled: true,
    });
    expect(out.adminOnlyBecauseStorePushOff).toBe(false);
    expect(out.vendorFcmUserIds.sort()).toEqual(['team-1', 'owner-1'].sort());
    expect(out.adminFcmUserIds.sort()).toEqual(['admin-1', 'admin-2'].sort());
    expect(out.inboxUserIds).toEqual(
      expect.arrayContaining([
        'team-1',
        'owner-1',
        'admin-1',
        'admin-2',
        'cust-1',
      ]),
    );
  });

  it('push ON → admin aussi dans l’équipe n’est pas doublé en vendor FCM', () => {
    const out = resolveStoreOrderNotifyPushFanout({
      storeTeamIds: ['team-1', 'admin-1'],
      platformAdminIds: ['admin-1', 'admin-2'],
      storePushEnabled: true,
    });
    expect(out.vendorFcmUserIds).toEqual(['team-1']);
    expect(out.adminFcmUserIds.sort()).toEqual(['admin-1', 'admin-2'].sort());
  });

  it('Fix: push boutique OFF → FCM/inbox admins uniquement (pas l’équipe)', () => {
    const out = resolveStoreOrderNotifyPushFanout({
      storeTeamIds: team,
      platformAdminIds: admins,
      customerUserId: 'cust-1',
      storePushEnabled: false,
    });
    expect(out.adminOnlyBecauseStorePushOff).toBe(true);
    expect(out.vendorFcmUserIds).toEqual([]);
    expect(out.adminFcmUserIds.sort()).toEqual(['admin-1', 'admin-2'].sort());
    expect(out.inboxUserIds.sort()).toEqual(['admin-1', 'admin-2'].sort());
  });

  it('n’envoie pas le client même s’il est aussi admin', () => {
    const out = resolveStoreOrderNotifyPushFanout({
      storeTeamIds: team,
      platformAdminIds: ['admin-1', 'cust-1'],
      customerUserId: 'cust-1',
      storePushEnabled: false,
    });
    expect(out.adminFcmUserIds).toEqual(['admin-1']);
  });

  it('push boutique OFF sans admin → aucun FCM (équipe respectée)', () => {
    const out = resolveStoreOrderNotifyPushFanout({
      storeTeamIds: team,
      platformAdminIds: [],
      storePushEnabled: false,
    });
    expect(out.vendorFcmUserIds).toEqual([]);
    expect(out.adminFcmUserIds).toEqual([]);
    expect(out.inboxUserIds).toEqual([]);
  });

  it('déduplique les ids et ignore les vides', () => {
    const out = resolveStoreOrderNotifyPushFanout({
      storeTeamIds: ['a', 'a', ''],
      platformAdminIds: ['a', 'b'],
      storePushEnabled: true,
    });
    // a est admin → uniquement dans adminFcm ; vendor vide pour a
    expect(out.vendorFcmUserIds).toEqual([]);
    expect(out.adminFcmUserIds.sort()).toEqual(['a', 'b'].sort());
  });
});
