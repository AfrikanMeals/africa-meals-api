import {
  buildAdminOrderNoteInboxMessage,
  buildAdminOrderNotePush,
  normalizeAdminOrderNote,
} from './admin-order-note.util';

describe('admin-order-note.util', () => {
  it('normalizeAdminOrderNote trim + max 2000', () => {
    expect(normalizeAdminOrderNote('  hello  ')).toBe('hello');
    expect(normalizeAdminOrderNote('x'.repeat(2500)).length).toBe(2000);
  });

  it('buildAdminOrderNoteInboxMessage inclut ref + note', () => {
    const msg = buildAdminOrderNoteInboxMessage({
      orderId: '507f1f77bcf86cd799439011',
      note: 'Merci de préparer plus tôt',
    });
    expect(msg).toContain('Note admin');
    expect(msg).toContain('Merci de préparer plus tôt');
    expect(msg).toMatch(/#439011/i);
  });

  it('buildAdminOrderNotePush titre + body tronqué', () => {
    const push = buildAdminOrderNotePush({
      orderId: 'abc123def456',
      note: 'x'.repeat(300),
      storeName: 'Resto Test',
    });
    expect(push.title).toBe('Note admin');
    expect(push.reason).toBe('admin_order_note');
    expect(push.body.length).toBeLessThanOrEqual(240);
    expect(push.body).toContain('Resto Test');
  });
});
