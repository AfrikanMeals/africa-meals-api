/** `fastify` when `main.ts` / PM2 / Docker ; absent on Firebase Functions (Express). */
export function isFastifyHttpAdapter(): boolean {
  return process.env.API_HTTP_ADAPTER === 'fastify';
}
