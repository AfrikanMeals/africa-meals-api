import {
  resolveEmailBrand,
  type EmailBrand,
} from '@modules/mailer/email-brand.util';
import type { ConfigService } from '@nestjs/config';
import axios from 'axios';

export type InvoiceBrandTheme = EmailBrand;

export function resolveInvoiceBrand(
  config: ConfigService | { get: (key: string) => string | undefined },
): InvoiceBrandTheme {
  return resolveEmailBrand(config);
}

/** Télécharge le logo marque pour inclusion dans le PDF (PNG/JPEG). */
export async function fetchInvoiceLogoBuffer(
  logoUrl: string | null | undefined,
): Promise<Buffer | null> {
  const url = logoUrl?.trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    return null;
  }
  try {
    const res = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: 10_000,
      maxContentLength: 2 * 1024 * 1024,
      validateStatus: (s) => s >= 200 && s < 300,
    });
    const buf = Buffer.from(res.data);
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}
