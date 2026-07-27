/**
 * Copie inbox / push / e-mail — assignation ou retrait de course livreur.
 * Canaux actifs : prefs `shippingDelivery` + push / e-mail (même règle client livraison).
 */

export type CourierAssignmentNotifyAction = 'assigned' | 'unassigned';

export function buildCourierAssignmentNotifyCopy(args: {
  action: CourierAssignmentNotifyAction;
  orderId: string;
  orderRef?: string;
  storeName?: string;
}): {
  title: string;
  body: string;
  orderRef: string;
  store: string;
  assigned: boolean;
} {
  const store = String(args.storeName ?? '').trim() || 'Restaurant';
  const oid = String(args.orderId ?? '').trim();
  const orderRef =
    String(args.orderRef ?? '').trim() ||
    (oid ? `#AE-${oid.slice(-6).toUpperCase()}` : '#AE-??????');
  const assigned = args.action === 'assigned';
  return {
    store,
    orderRef,
    assigned,
    title: assigned ? 'Nouvelle course' : 'Course retirée',
    body: assigned
      ? `${store} : la course ${orderRef} vous a été assignée. Ouvrez la carte pour démarrer.`
      : `${store} : la course ${orderRef} ne vous est plus assignée.`,
  };
}
