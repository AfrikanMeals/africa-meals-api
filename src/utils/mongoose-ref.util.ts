import { Types } from 'mongoose';

/** ObjectId hex depuis une ref Mongoose (ObjectId, string, document peuplé ou lean). */
export function objectIdStringFromRef(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  if (raw instanceof Types.ObjectId) {
    return raw.toHexString();
  }
  if (typeof raw === 'object' && '_id' in (raw as object)) {
    const id = (raw as { _id: unknown })._id;
    if (id instanceof Types.ObjectId) {
      return id.toHexString();
    }
    const s = String(id ?? '').trim();
    return Types.ObjectId.isValid(s) ? s : undefined;
  }
  const s = String(raw).trim();
  return Types.ObjectId.isValid(s) ? s : undefined;
}
