/**
 * Minimal in-process TTL cache.
 *
 * The API runs as a single instance (Render free plan), so an in-memory cache is
 * sufficient to take the load off expensive, slowly-changing reads (e.g. the
 * global leaderboard aggregation). For multi-instance deployments this should be
 * swapped for a shared store such as Redis.
 *
 * A TTL of 0 (or less) disables caching for that entry — used in development so
 * reads are always fresh and testing is never confused by stale data.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

export const cacheGet = <T>(key: string): T | undefined => {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.value as T;
};

export const cacheSet = <T>(key: string, value: T, ttlMs: number): void => {
  if (ttlMs <= 0) return; // caching disabled (e.g. development)
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
};

/** Explicitly drop a cached entry (e.g. after a write that invalidates it). */
export const cacheDelete = (key: string): void => {
  store.delete(key);
};
