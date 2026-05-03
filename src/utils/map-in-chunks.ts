/**
 * Exécute `fn` sur chaque élément en limitant le parallélisme (évite les pics
 * de dizaines de `countDocuments` / `findOne` simultanés sur un même pool Mongo).
 */
export async function mapInChunks<T, R>(
  items: readonly T[],
  chunkSize: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const size = Math.max(1, Math.floor(chunkSize));
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    const chunk = items.slice(i, i + size);
    const part = await Promise.all(chunk.map((x) => fn(x)));
    out.push(...part);
  }
  return out;
}
