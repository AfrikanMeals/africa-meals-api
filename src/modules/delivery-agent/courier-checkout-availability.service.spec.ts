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
  nearbyCourierIds?: string[];
}) {
  const orders = {
    aggregate: jest.fn(() => ({
      exec: jest.fn(async () =>
        args.activeOrders ? [{ n: args.activeOrders }] : [],
      ),
    })),
  };
  const stores = storeModel({
    _id: STORE_ID,
    supportsShipping: true,
    vendorManagesDeliveryDrivers: true,
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
    isStoreManagedDelivery: jest.fn(() => true),
    storeAssignmentMode: jest.fn(() => 'AUTO'),
    listActiveDriverUserIdsForStore: jest.fn(async () => args.activeDriverIds),
  };
  const platformShipping = {
    getPublicSettings: jest.fn(async () => ({ maxDeliveryRadiusKm: 15 })),
  };
  const subscriptions = {
    resolveStoreDeliveryPolicy: jest.fn(async () => ({
      selfDeliveryRequired: args.selfDeliveryRequired ?? true,
      maxDeliveryAgents: 5,
      platformPoolEnabled: !(args.selfDeliveryRequired ?? true),
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
  return { service, orders, applications };
}

describe('CourierCheckoutAvailabilityService', () => {
  it('masque Livraison quand la flotte boutique ne contient aucun livreur actif', async () => {
    const { service, orders } = buildService({ activeDriverIds: [] });

    // La stratégie boutique répond sans requête capacité inutile.
    await expect(service.checkStores([STORE_ID])).resolves.toEqual({
      items: [
        {
          storeId: STORE_ID,
          state: 'unavailable',
          strategy: 'store_fleet',
          reason: 'no_online_courier',
        },
      ],
    });
    expect(orders.aggregate).not.toHaveBeenCalled();
  });

  it('autorise Livraison dès qu’un partenaire approuvé a de la capacité', async () => {
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
    });

    // Le court-circuit confirme le premier livreur réellement assignable.
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

  it('utilise le pool plateforme après une flotte AUTO vide si le plan le permet', async () => {
    const { service, orders } = buildService({
      activeDriverIds: [],
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

    // La stratégie hybride conserve la cascade plateforme autorisée par abonnement.
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
});
