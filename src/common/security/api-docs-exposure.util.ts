/** Swagger `/api/docs` et GraphQL Playground — désactivés en prod par défaut (M-02). */

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function isSwaggerEnabled(): boolean {
  if (process.env.DISABLE_SWAGGER === 'true') {
    return false;
  }
  if (isProductionRuntime()) {
    return process.env.ENABLE_SWAGGER_IN_PROD === 'true';
  }
  return true;
}

export function isGraphqlPlaygroundEnabled(): boolean {
  if (process.env.DISABLE_GRAPHQL_PLAYGROUND === 'true') {
    return false;
  }
  if (isProductionRuntime()) {
    return process.env.ENABLE_GRAPHQL_PLAYGROUND_IN_PROD === 'true';
  }
  return true;
}
