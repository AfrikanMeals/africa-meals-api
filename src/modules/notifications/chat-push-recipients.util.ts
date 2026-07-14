/**
 * Répartit les destinataires push chat par audience mobile (customer / courier / vendor).
 * Exclude l’expéditeur ; les ids vendeur (= équipe boutique) sont isolés pour le gate prefs.
 */
export function partitionChatPushRecipients(args: {
  recipientUserIds: string[];
  senderUserId?: string | null;
  vendorTeamUserIds?: string[];
  courierUserId?: string | null;
}): {
  customerUserIds: string[];
  courierUserIds: string[];
  vendorUserIds: string[];
} {
  const sender = normalizeId(args.senderUserId);
  const vendorSet = new Set(
    (args.vendorTeamUserIds ?? []).map(normalizeId).filter(Boolean),
  );
  const courier = normalizeId(args.courierUserId);

  const customer = new Set<string>();
  const courierIds = new Set<string>();
  const vendor = new Set<string>();

  for (const raw of args.recipientUserIds) {
    const id = normalizeId(raw);
    if (!id || id === sender) continue;
    if (vendorSet.has(id)) {
      vendor.add(id);
      continue;
    }
    if (courier && id === courier) {
      courierIds.add(id);
      continue;
    }
    customer.add(id);
  }

  // Force métier même si absent de recipientUserIds (filet API).
  if (courier && courier !== sender && !vendorSet.has(courier)) {
    courierIds.add(courier);
  }

  return {
    customerUserIds: [...customer],
    courierUserIds: [...courierIds],
    vendorUserIds: [...vendor],
  };
}

function normalizeId(raw: string | null | undefined): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase();
}
