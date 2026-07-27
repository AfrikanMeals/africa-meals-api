import { buildCourierAssignmentNotifyCopy } from './courier-assignment-notify.util';

describe('buildCourierAssignmentNotifyCopy', () => {
  it('assigned — titre Nouvelle course + ref dérivée', () => {
    const c = buildCourierAssignmentNotifyCopy({
      action: 'assigned',
      orderId: '65f0abc1234567890abcdef1',
      storeName: 'Resto 102',
    });
    expect(c.assigned).toBe(true);
    expect(c.title).toBe('Nouvelle course');
    expect(c.orderRef).toBe('#AE-BCDEF1');
    expect(c.body).toContain('Resto 102');
    expect(c.body).toContain('assignée');
  });

  it('unassigned — Course retirée', () => {
    const c = buildCourierAssignmentNotifyCopy({
      action: 'unassigned',
      orderId: 'abc',
      orderRef: '#AE-TEST1',
      storeName: '  ',
    });
    expect(c.assigned).toBe(false);
    expect(c.title).toBe('Course retirée');
    expect(c.store).toBe('Restaurant');
    expect(c.orderRef).toBe('#AE-TEST1');
  });
});
