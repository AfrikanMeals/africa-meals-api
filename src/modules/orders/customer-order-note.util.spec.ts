import {
  buildCustomerOrderNoteInboxMessage,
  buildCustomerOrderNotePush,
  customerOrderNoteAllowedStatuses,
  normalizeCustomerOrderNote,
} from './customer-order-note.util';

describe('customer-order-note.util', () => {
  it('normalizeCustomerOrderNote trim + max 2000', () => {
    expect(normalizeCustomerOrderNote('  hi  ')).toBe('hi');
    expect(normalizeCustomerOrderNote('x'.repeat(2500)).length).toBe(2000);
  });

  it('buildCustomerOrderNoteInboxMessage', () => {
    const msg = buildCustomerOrderNoteInboxMessage({
      orderId: '507f1f77bcf86cd799439011',
      note: 'Sans oignon SVP',
    });
    expect(msg).toContain('Note client');
    expect(msg).toMatch(/#439011/i);
    expect(msg).toContain('Sans oignon SVP');
  });

  it('buildCustomerOrderNotePush', () => {
    const push = buildCustomerOrderNotePush({
      orderId: 'abc123def456',
      note: 'x'.repeat(300),
      storeName: 'Resto',
    });
    expect(push.title).toBe('Note client');
    expect(push.reason).toBe('customer_order_note');
    expect(push.body.length).toBeLessThanOrEqual(240);
  });

  it('customerOrderNoteAllowedStatuses bloque terminaux', () => {
    expect(customerOrderNoteAllowedStatuses('paied')).toBe(true);
    expect(customerOrderNoteAllowedStatuses('approved')).toBe(true);
    expect(customerOrderNoteAllowedStatuses('cancelled')).toBe(false);
    expect(customerOrderNoteAllowedStatuses('completed')).toBe(false);
  });
});
