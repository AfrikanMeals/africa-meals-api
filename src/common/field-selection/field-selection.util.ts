import type { FieldSelectionSpec } from './field-selection.types';

const MAX_PATHS = 64;
const MAX_SEGMENTS = 24;

/** Sérialisation légère pour réponses API (évite de muter les docs Mongoose). */
export function toPlainJson(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function mergeDeep(a: unknown, b: unknown): unknown {
  if (b === undefined) return a;
  if (a === undefined) return b;
  if (a === null) return b;
  if (b === null) return a;
  if (Array.isArray(a) && Array.isArray(b)) {
    const len = Math.max(a.length, b.length);
    const out: unknown[] = [];
    for (let i = 0; i < len; i++) {
      out.push(mergeDeep(a[i], b[i]));
    }
    return out;
  }
  if (
    typeof a === 'object' &&
    typeof b === 'object' &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    const A = a as Record<string, unknown>;
    const B = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(A), ...Object.keys(B)]);
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      if (k in A && k in B) {
        out[k] = mergeDeep(A[k], B[k]);
      } else if (k in B) {
        out[k] = B[k];
      } else {
        out[k] = A[k];
      }
    }
    return out;
  }
  return b;
}

/**
 * Construit un sous-arbre depuis [root] en suivant les segments.
 * Si une propriété est un tableau, applique les segments restants à chaque élément.
 */
export function buildIncludeBranch(obj: unknown, segments: string[]): unknown {
  if (obj === undefined) return undefined;
  if (segments.length === 0) {
    return toPlainJson(obj);
  }
  const [head, ...tail] = segments;
  if (obj === null || typeof obj !== 'object') {
    return undefined;
  }
  if (Array.isArray(obj)) {
    const mapped = obj
      .map((el) => buildIncludeBranch(el, segments))
      .filter((v) => v !== undefined);
    return mapped.length ? mapped : undefined;
  }
  const rec = obj as Record<string, unknown>;
  if (!(head in rec)) return undefined;
  const child = rec[head];
  if (tail.length === 0) {
    return { [head]: toPlainJson(child) };
  }
  if (Array.isArray(child)) {
    const mapped = child
      .map((el) => buildIncludeBranch(el, tail))
      .filter((v) => v !== undefined);
    if (!mapped.length) return undefined;
    return { [head]: mapped };
  }
  const branch = buildIncludeBranch(child, tail);
  if (branch === undefined) return undefined;
  return { [head]: branch };
}

export function applyIncludePaths(root: unknown, paths: string[]): unknown {
  let acc: unknown = undefined;
  for (const raw of paths) {
    const segs = raw.split('.').filter(Boolean);
    if (!segs.length || segs.length > MAX_SEGMENTS) continue;
    const branch = buildIncludeBranch(root, segs);
    if (branch === undefined) continue;
    acc = acc === undefined ? branch : mergeDeep(acc, branch);
  }
  return acc === undefined ? {} : acc;
}

export function omitPath(obj: unknown, segments: string[]): void {
  if (segments.length === 0 || obj === null || typeof obj !== 'object') {
    return;
  }
  const [head, ...tail] = segments;
  if (Array.isArray(obj)) {
    if (tail.length === 0) return;
    for (const el of obj) omitPath(el, tail);
    return;
  }
  const rec = obj as Record<string, unknown>;
  if (!(head in rec)) return;
  if (tail.length === 0) {
    delete rec[head];
    return;
  }
  const child = rec[head];
  if (Array.isArray(child)) {
    for (const el of child) omitPath(el, tail);
  } else {
    omitPath(child, tail);
  }
}

export function applyExcludePaths(root: unknown, paths: string[]): unknown {
  const plain = toPlainJson(root);
  for (const raw of paths) {
    const segs = raw.split('.').filter(Boolean);
    if (!segs.length || segs.length > MAX_SEGMENTS) continue;
    omitPath(plain, segs);
  }
  return plain;
}

export function applyFieldSelection(
  data: unknown,
  spec: FieldSelectionSpec,
): unknown {
  let out = data;
  if (spec.includePaths.length) {
    out = applyIncludePaths(data, spec.includePaths);
  }
  if (spec.excludePaths.length) {
    out = applyExcludePaths(out, spec.excludePaths);
  }
  return out;
}

function normalizeQueryList(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  const parts: string[] = [];
  const pushRaw = (s: string) => {
    for (const piece of s.split(',')) {
      const t = piece.trim();
      if (t) parts.push(t);
    }
  };
  if (Array.isArray(value)) {
    for (const v of value) pushRaw(String(v));
  } else {
    pushRaw(String(value));
  }
  return parts.slice(0, MAX_PATHS);
}

/** Parse query Express (sans middleware). */
export function parseFieldSelectionFromQuery(
  query: Record<string, unknown>,
): FieldSelectionSpec {
  const inc = normalizeQueryList(
    query.includeFields as string | string[] | undefined,
  );
  const exSingle = normalizeQueryList(
    query.excludeField as string | string[] | undefined,
  );
  const exPlural = normalizeQueryList(
    query.excludeFields as string | string[] | undefined,
  );
  const excludePaths = [...exSingle, ...exPlural].slice(0, MAX_PATHS);
  return { includePaths: inc, excludePaths };
}
