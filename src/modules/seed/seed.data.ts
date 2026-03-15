import { AddressTypeEnum } from '@schemas/address.schema';
import { StoreStatusEnum } from '@schemas/store.schema';
import { ProductStatusEnum } from '@schemas/product.schema';
import { UserTypeEnum } from '@schemas/user.schema';

const CITIES = [
  'Montréal',
  'Québec',
  'Laval',
  'Toronto',
  'Ottawa',
  'Calgary',
  'Vancouver',
  'Dakar',
  'Douala',
  'Abidjan',
];

const STORE_NAMES = [
  'Le Ndolè Express',
  'Maquis Afrique',
  'Chez Fatou',
  'Savoury Cameroon',
  'Taste of Senegal',
  'Jollof House',
  'Fufu & Soup',
  'African Delight',
  'Spice Road Kitchen',
  'Mama\'s Kitchen',
];

const MEAL_NAMES = [
  'Ndolè',
  'Poulet braisé',
  'Thiou',
  'Caldou',
  'Soupou Kandja',
  'Eru',
  'Okok',
  'Koki',
  'Pâte d\'arachide',
  'Riz au gras',
  'Attiéké',
  'Alloco',
  'Kedjenou',
  'Garba',
  'Foufou banane',
  'Mafé',
  'Yassa',
  'Thiéboudiène',
  'Poulet DG',
  'Bobolo',
];

const ORIGIN_COUNTRIES = ['Cameroun', 'Sénégal', 'Côte d\'Ivoire', 'Nigeria', 'Ghana', 'Bénin', 'Togo'];

export interface MockAddress {
  address: string;
  country: string;
  city: string;
  countryCode: string;
  zipCode: string;
  type: AddressTypeEnum;
  location: { type: 'Point'; coordinates: number[] };
}

export interface MockUser {
  type: UserTypeEnum;
  fullName: string;
  email: string;
  phoneNumber: string;
  password: string;
}

export interface MockStore {
  name: string;
  bio: string;
  email: string;
  phoneNumber: string;
  currency: string;
  status: StoreStatusEnum;
  acceptsOrders: boolean;
  canCreateProducts: boolean;
  supportsShipping: boolean;
  shippingZones: Array<{ minDistance: number; maxDistance: number; price: number }>;
}

export interface MockProduct {
  title: string;
  bio: string;
  about: string;
  originCountry: string;
  price: number;
  discountPrice: number;
  currency: string;
  status: ProductStatusEnum;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomPrice(min: number, max: number): number {
  return Math.round((min + Math.random() * (max - min)) * 100) / 100;
}

export function getMockAddresses(): MockAddress[] {
  return CITIES.map((city, i) => ({
    address: `${100 + i * 10} rue Commerce`,
    country: 'Canada',
    city,
    countryCode: 'CA',
    zipCode: `H2X ${1 + i}Y4`,
    type: AddressTypeEnum.SHOP,
    location: {
      type: 'Point' as const,
      coordinates: [-73.5 + i * 0.01, 45.5 + i * 0.01],
    },
  }));
}

export function getMockUsers(): MockUser[] {
  return STORE_NAMES.map((_, i) => ({
    type: UserTypeEnum.VENDOR,
    fullName: `Vendor ${i + 1}`,
    email: `vendor${i + 1}@seed.africameals.com`,
    phoneNumber: `+1416555${String(1000 + i).padStart(4, '0')}`,
    password: 'SeedPassword123!',
  }));
}

export function getMockStores(): MockStore[] {
  return STORE_NAMES.map((name, i) => ({
    name,
    bio: `Cuisine africaine authentique - ${CITIES[i]}. Plats traditionnels et modernes.`,
    email: `contact@${name.toLowerCase().replace(/\s+/g, '')}.com`,
    phoneNumber: `+1416555${String(2000 + i).padStart(4, '0')}`,
    currency: 'CAD',
    status: StoreStatusEnum.ACTIVE,
    acceptsOrders: true,
    canCreateProducts: true,
    supportsShipping: true,
    shippingZones: [
      { minDistance: 0, maxDistance: 5, price: 3.99 },
      { minDistance: 5, maxDistance: 10, price: 5.99 },
      { minDistance: 10, maxDistance: 20, price: 8.99 },
    ],
  }));
}

export function getMockProductsForStore(count: number): MockProduct[] {
  const products: MockProduct[] = [];
  const used = new Set<string>();
  for (let i = 0; i < count; i++) {
    let title = pick(MEAL_NAMES);
    while (used.has(title)) {
      title = `${pick(MEAL_NAMES)} ${pick(['traditionnel', 'spécial', 'maison', 'du chef'])}`;
    }
    used.add(title);
    const price = randomPrice(8, 28);
    products.push({
      title,
      bio: `Délicieux plat traditionnel. ${title} préparé avec soin.`,
      about: `Notre ${title} est préparé selon la recette traditionnelle avec des ingrédients frais.`,
      originCountry: pick(ORIGIN_COUNTRIES),
      price,
      discountPrice: Math.random() > 0.5 ? randomPrice(1, price - 1) : 0,
      currency: 'CAD',
      status: ProductStatusEnum.ACTIVE,
    });
  }
  return products;
}
