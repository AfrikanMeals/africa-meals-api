/**
 * Extraction coords livraison / boutique pour VROOM / ranking / tournée.
 * Snapshot livraison prioritaire, puis adresse user.
 */

export function deliveryLngLatFromOrder(
  order: Record<string, unknown> | null | undefined,
): [number, number] | null {
  if (!order) return null;

  const snap =
    order['deliveryAddressSnapshot'] ?? order['delivery_address_snapshot'];
  const fromSnap = coordsFromAddressLike(snap);
  if (fromSnap) return fromSnap;

  const shipping = order['shippingAddress'] ?? order['shipping_address'];
  const fromShip = coordsFromAddressLike(shipping);
  if (fromShip) return fromShip;

  const user = order['user'];
  if (user && typeof user === 'object') {
    const addrs = (user as { addresses?: unknown }).addresses;
    if (Array.isArray(addrs)) {
      for (const a of addrs) {
        const c = coordsFromAddressLike(a);
        if (c) return c;
      }
    }
    const def = (user as { defaultAddress?: unknown }).defaultAddress;
    const fromDef = coordsFromAddressLike(def);
    if (fromDef) return fromDef;
  }

  return null;
}

/** Coords boutique (store.address.location ou store.location). */
export function storeLngLatFromOrder(
  order: Record<string, unknown> | null | undefined,
): [number, number] | null {
  if (!order) return null;
  const store = order.store;
  if (store && typeof store === 'object') {
    const s = store as Record<string, unknown>;
    const addr = s.address;
    if (addr && typeof addr === 'object') {
      const fromAddr = coordsFromAddressLike(addr);
      if (fromAddr) return fromAddr;
    }
    const fromStore = coordsFromAddressLike(s);
    if (fromStore) return fromStore;
  }
  return null;
}

function coordsFromAddressLike(raw: unknown): [number, number] | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const loc = o.location ?? o.geo;
  if (loc && typeof loc === 'object') {
    const coords = (loc as { coordinates?: unknown }).coordinates;
    if (Array.isArray(coords) && coords.length >= 2) {
      const lng = Number(coords[0]);
      const lat = Number(coords[1]);
      if (Number.isFinite(lng) && Number.isFinite(lat)) return [lng, lat];
    }
  }
  const lat = Number(o.lat ?? o.latitude);
  const lng = Number(o.lng ?? o.longitude ?? o.lon);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return [lng, lat];
  return null;
}
