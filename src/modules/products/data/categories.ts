import { ProductCategoryKindEnum } from '@schemas/product-category.schema';

export const DEFAULT_CATEGORIES = [
  {
    title: 'Repas',
    icon: 'meals',
    kind: ProductCategoryKindEnum.FOOD,
  },
  {
    title: 'Boissons Naturels',
    icon: 'natural_drink',
    kind: ProductCategoryKindEnum.DRINK,
  },
  {
    title: 'Fruits et deserts',
    icon: 'fruits',
    kind: ProductCategoryKindEnum.FOOD,
  },
  {
    title: 'Boissons Alcoolisés',
    icon: 'alcoholic_drink',
    kind: ProductCategoryKindEnum.DRINK,
  },
  {
    title: 'Fast Food',
    icon: 'burger',
    kind: ProductCategoryKindEnum.FOOD,
  },
  {
    title: 'Vins',
    icon: 'wine',
    kind: ProductCategoryKindEnum.DRINK,
  },
];

/** Icônes seed → type boisson (rétrocompatibilité sans champ `kind` en base). */
export const DRINK_CATEGORY_ICONS = new Set([
  'natural_drink',
  'alcoholic_drink',
  'wine',
]);

/** Type effectif d’une catégorie (aligné admin + seed). */
export function resolveProductCategoryKind(
  raw: Record<string, unknown>,
): ProductCategoryKindEnum {
  const k = raw.kind ?? raw.category_kind;
  if (k === ProductCategoryKindEnum.DRINK || k === 'drink') {
    return ProductCategoryKindEnum.DRINK;
  }
  if (k === ProductCategoryKindEnum.FOOD || k === 'food') {
    return ProductCategoryKindEnum.FOOD;
  }
  const icon = String(raw.icon ?? '').trim();
  if (DRINK_CATEGORY_ICONS.has(icon)) {
    return ProductCategoryKindEnum.DRINK;
  }
  return ProductCategoryKindEnum.FOOD;
}
