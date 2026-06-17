/** Limites corps HTTP (M-03). */
export const DEFAULT_JSON_BODY_LIMIT =
  process.env.HTTP_JSON_BODY_LIMIT?.trim() || '5mb';

export const UPLOAD_JSON_BODY_LIMIT =
  process.env.HTTP_UPLOAD_JSON_BODY_LIMIT?.trim() || '25mb';

export const DEFAULT_URLENCODED_BODY_LIMIT =
  process.env.HTTP_URLENCODED_BODY_LIMIT?.trim() || '1mb';
