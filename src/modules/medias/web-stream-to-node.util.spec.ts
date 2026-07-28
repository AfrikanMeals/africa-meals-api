import { webReadableToNodePassThrough } from './web-stream-to-node.util';

describe('webReadableToNodePassThrough', () => {
  // Proxy médias Fastify : conversion Web→Node sans Readable.fromWeb.
  it('pours un ReadableStream Web vers un Buffer Node', async () => {
    const payload = new TextEncoder().encode('trophy-gif');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(payload);
        controller.close();
      },
    });
    const node = webReadableToNodePassThrough(stream);
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      node.on('data', (c: Buffer) => chunks.push(c));
      node.on('end', () => resolve());
      node.on('error', reject);
    });
    expect(Buffer.concat(chunks).toString('utf8')).toBe('trophy-gif');
  });
});
