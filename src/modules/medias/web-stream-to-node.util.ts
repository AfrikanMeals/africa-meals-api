import { PassThrough, type Readable } from 'stream';

/**
 * Convertit un ReadableStream Web (fetch / @vercel/blob) en flux Node.
 * Évite `Readable.fromWeb` (TypeError cross-realm sous certains runtimes Nest).
 */
export function webReadableToNodePassThrough(
  webStream: ReadableStream<Uint8Array>,
): Readable {
  const pass = new PassThrough();
  const reader = webStream.getReader();
  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          pass.end();
          break;
        }
        if (value) pass.write(Buffer.from(value));
      }
    } catch (err) {
      pass.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  })();
  return pass;
}
