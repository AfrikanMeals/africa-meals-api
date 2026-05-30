/** Résultat du middleware (requête HTTP). */
export type FieldSelectionSpec = {
  /** Chemins inclus (notation point), ex. `user.addresses.id`. */
  includePaths: string[];
  /** Chemins exclus après projection éventuelle. */
  excludePaths: string[];
};

export const FIELD_SELECTION_REQUEST_PROP =
  'africaMealsFieldSelection' as const;
