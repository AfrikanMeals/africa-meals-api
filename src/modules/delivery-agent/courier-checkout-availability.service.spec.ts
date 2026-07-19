import { CourierCheckoutAvailabilityService } from './courier-checkout-availability.service';

const STORE_ID = '507f1f77bcf86cd799439011';
const COURIER_ID = '507f1f77bcf86cd799439012';

/** Reproduit une chaîne Mongoose `findById().select().populate().lean().exec()`. */
function storeModel(store: Record<string, unknown>) {
  const chain = {
    select: jest.fn(() => chain),
    populate: jest.fn(() => chain),
    lean: jest.fn(() => chain),
    exec: jest.fn(async () => store),
  };
  return { findById: jest.fn(() => chain) };
}

/** Reproduit une chaîne Mongoose `find().select().lean().exec()`. */
function applicationModel(rows: Record<string, unknown>[]) {
  const chain = {
    select: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    lean: jest.fn(() => chain),
    exec: jest.fn(async () => rows),
  };
  return { find: jest.fn(() => chain) };
}

/** Construit le service avec uniquement les dépendances utiles au scénario. */
function buildService(args: {
  activeDriverIds: string[];
  applications?: Record<string, unknown>[];
  activeOrders?: number;
  selfDeliveryRequired?: boolean;
  managed?: boolean;
  nearbyCourierIds?: string[];
  supportsShipping?: boolean;
}) {
  const orders = {
    aggregate: jest.fn(() => ({
      exec: jest.fn(async () =>
        args.activeOrders ? [{ n: args.activeOrders }] : [],
      ),
    })),
  };
  const managed = args.managed ?? true;
  const stores = storeModel({
    _id: STORE_ID,
    supportsShipping: args.supportsShipping ?? true,
    vendorManagesDeliveryDrivers: managed,
    deliveryAssignmentMode: 'AUTO',
    region: 'CM',
    address: { location: { coordinates: [11.5, 3.85] } },
  });
  const applications = applicationModel(args.applications ?? []);
  const courierGeo = {
    searchNearby: jest.fn(async () =>
      (args.nearbyCourierIds ?? []).map((agentUserId) => ({
        agentUserId,
        distanceMeters: 1000,
      })),
    ),
  };
  const storeDrivers = {
    isStoreManagedDelivery: jest.fn(() => managed),
    storeAssignmentMode: jest.fn(() => 'AUTO'),
    listActiveDriverUserIdsForStore: jest.fn(async () => args.activeDriverIds),
  };
  const platformShipping = {
    getPublicSettings: jest.fn(async () => ({ maxDeliveryRadiusKm: 15 })),
  };
  const subscriptions = {
    resolveStoreDeliveryPolicy: jest.fn(async () => ({
      selfDeliveryRequired: args.selfDeliveryRequired ?? false,
      maxDeliveryAgents: 5,
      platformPoolEnabled: !(args.selfDeliveryRequired ?? false),
    })),
  };
  const service = new CourierCheckoutAvailabilityService(
    orders as never,
    stores as never,
    applications as never,
    courierGeo as never,
    storeDrivers as never,
    platformShipping as never,
    subscriptions as never,
  );
  return { service, orders, applications, courierGeo };
}

describe('CourierCheckoutAvailabilityService', () => {
  it('ouvre Livraison via self-shipping quand la flotte est vide', async () => {
    const { service, orders, courierGeo } = buildService({
      activeDriverIds: [],
      selfDeliveryRequired: true,
      managed: true,
    });

    // Fix: plus de faux « aucun livreur » — le vendeur peut s’assigner.
    await expect(service.checkStores([STORE_ID])).resolves.toEqual({
      items: [
        {
          storeId: STORE_ID,
          state: 'available',
          strategy: 'store_fleet',
          reason: 'vendor_self_delivery',
        },
      ],
    });
    expect(orders.aggregate).not.toHaveBeenCalled();
    expect(courierGeo.searchNearby).not.toHaveBeenCalled();
  });

  it('autorise Livraison dès qu’un partenaire flotte a de la capacité', async () => {
    const { service, orders } = buildService({
      activeDriverIds: [COURIER_ID],
      applications: [
        {
          user: COURIER_ID,
          region: 'CM',
          dashboardAvailability: 'disponible',
          maxConcurrentOrders: 1,
        },
      ],
      activeOrders: 0,
      managed: true,
    });

    await expect(service.checkStores([STORE_ID])).resolves.toEqual({
      items: [
        {
          storeId: STORE_ID,
          state: 'available',
          strategy: 'store_fleet',
        },
      ],
    });
    expect(orders.aggregate).toHaveBeenCalledTimes(1);
  });

  it('utilise le pool plateforme pour une boutique non gérée', async () => {
    const { service, orders } = buildService({
      activeDriverIds: [],
      managed: false,
      selfDeliveryRequired: false,
      nearbyCourierIds: [COURIER_ID],
      applications: [
        {
          user: COURIER_ID,
          region: 'CM',
          dashboardAvailability: 'disponible',
          maxConcurrentOrders: 1,
        },
      ],
    });

    await expect(service.checkStores([STORE_ID])).resolves.toEqual({
      items: [
        {
          storeId: STORE_ID,
          state: 'available',
          strategy: 'platform',
        },
      ],
    });
    expect(orders.aggregate).toHaveBeenCalledTimes(1);
  });

  it('masque Livraison sans flotte, sans self-shipping et sans pool', async () => {
    const { service } = buildService({
      activeDriverIds: [],
      managed: false,
      selfDeliveryRequired: false,
      nearbyCourierIds: [],
    });

    await expect(service.checkStores([STORE_ID])).resolves.toEqual({
      items: [
        {
          storeId: STORE_ID,
          state: 'unavailable',
          strategy: 'platform',
          reason: 'no_online_courier',
        },
      ],
    });
  });
});
