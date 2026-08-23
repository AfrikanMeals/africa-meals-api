import {
  sendNestHttpBody,
  setNestHttpHeader,
  type NestHttpResponse,
} from '@common/http/http-response.util';
import type { GoogleMerchantExportResult } from './google-merchant.types';

export type SendGoogleMerchantExportOptions = {
  /** Prévisualisation admin / export boutique : pièce jointe téléchargeable. */
  asAttachment?: boolean;
};

/**
 * Envoie le flux GMC via Fastify (`reply.header` / `reply.send`).
 * `res.setHeader` Express n’existe pas sur FastifyReply → 500 crawler Google.
 */
export function sendGoogleMerchantExport(
  res: NestHttpResponse,
  result: GoogleMerchantExportResult,
  options?: SendGoogleMerchantExportOptions,
): void {
  // Cache interdit : le crawler GMC doit toujours relire le catalogue courant.
  setNestHttpHeader(res, 'Cache-Control', 'no-store');
  if (options?.asAttachment) {
    // Téléchargement admin/boutique ; l’URL crawler reste inline (pas de Disposition).
    setNestHttpHeader(
      res,
      'Content-Disposition',
      `attachment; filename="${result.filename}"`,
    );
  }
  sendNestHttpBody(res, 200, result.body, result.contentType);
}
