import type { ScoreProject } from '../../domain/score/types.ts';

/** Exact JSON fingerprint for immutable editor snapshots. Unchanged subtrees are
 * serialized once; callers editing mutable drafts must use JSON.stringify. */
export function createProjectFingerprint() {
  const serialized = new WeakMap<object, string>();
  function encode(value: unknown): string | undefined {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    const cached = serialized.get(value);
    if (cached !== undefined) return cached;
    const result = Array.isArray(value)
      ? `[${Array.from(value, item => encode(item) ?? 'null').join(',')}]`
      : `{${Object.keys(value).flatMap(key => {
        const item = encode((value as Record<string, unknown>)[key]);
        return item === undefined ? [] : [`${JSON.stringify(key)}:${item}`];
      }).join(',')}}`;
    serialized.set(value, result);
    return result;
  }
  return (project: ScoreProject): string => encode(project)!;
}
