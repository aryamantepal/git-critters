// How an egg hatches. Pure, like the rest of this folder.
import type { Traits } from "../engine/traits.ts";

/** Contributions since the workflow was added that make an egg hatch. */
export const HATCH_AFTER = 25;

/** Crack level 0 to 3 for an egg that hasn't hatched: quarters of the way to `HATCH_AFTER`. */
export function crackLevelFor(contributions: number): Traits["stage"] {
  return Math.min(3, Math.floor((contributions * 4) / HATCH_AFTER)) as Traits["stage"];
}

export function hasHatched(contributions: number): boolean {
  return contributions >= HATCH_AFTER;
}

/** The day automatic hatching shipped. Every critter in the pool since then belongs to this epoch. */
export const POOL_EPOCH = "2026-11-14T00:00:00Z";

/** One entry per hatchling, with its activation time. */
export interface PoolEntry {
  id: string;
  /** UTC activation timestamp, chosen after publication. Earlier workflows cannot hatch it. */
  introducedAt: `${number}-${number}-${number}T${string}Z`;
}

/**
 * The full pool used by the site's new automatic hatchling flow. Append only: never edit,
 * reorder, or remove an entry, and never change an entry's `introducedAt`. A workflow
 * added before a critter's activation time keeps hatching from the earlier pool, so appending is the
 * only change that can't mutate an existing user's hatched critter.
 */
export const HATCHLING_POOL: readonly PoolEntry[] = Object.freeze([
  { id: "dragon", introducedAt: POOL_EPOCH },
  { id: "axolotl", introducedAt: POOL_EPOCH },
  { id: "jellyfish", introducedAt: POOL_EPOCH },
  { id: "ghost", introducedAt: POOL_EPOCH },
  { id: "robot", introducedAt: POOL_EPOCH },
  { id: "cat", introducedAt: POOL_EPOCH },
  { id: "frog", introducedAt: POOL_EPOCH },
  { id: "mushroom", introducedAt: POOL_EPOCH },
  { id: "turtle", introducedAt: POOL_EPOCH },
  { id: "bat", introducedAt: POOL_EPOCH },
  { id: "penguin", introducedAt: POOL_EPOCH },
  { id: "fox", introducedAt: POOL_EPOCH },
]);

/**
 * The original `critter: surprise` pool. Never change this list: existing workflows
 * still use it, and changing it would silently replace their promised hatchling.
 */
export const LEGACY_SURPRISE_POOL: readonly string[] = Object.freeze(["dragon", "axolotl", "jellyfish", "ghost"]);

/** FNV-1a over the login in lower case, so `Sam` and `sam` hash the same. */
export function hashLogin(login: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(login.toLowerCase())) {
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * The pool a workflow added on `addedAt` hatches from: the entries active at that instant.
 * Anything earlier falls back to the original epoch's pool, and no `addedAt` (the site's
 * preview) sees the whole pool.
 */
export function poolFor(addedAt?: Date, pool: readonly PoolEntry[] = HATCHLING_POOL): readonly PoolEntry[] {
  if (!addedAt) return pool;
  const cutoff = Math.max(addedAt.getTime(), Date.parse(POOL_EPOCH));
  return pool.filter((entry) => Date.parse(entry.introducedAt) <= cutoff);
}

/** The hatchling for a login from a given pool, by FNV-1a over the lower-cased login. */
export function hatchlingFromPool(pool: readonly PoolEntry[], login: string): string {
  return pool[hashLogin(login) % pool.length].id;
}

/** The hatchling for a login, from the pool its workflow's age allows. Without `addedAt`, the full pool. */
export function hatchlingFor(login: string, addedAt?: Date): string {
  return hatchlingFromPool(poolFor(addedAt), login);
}

/** Preserve the mapping used by workflows that explicitly say `critter: surprise`. */
export function legacySurpriseFor(login: string): string {
  return LEGACY_SURPRISE_POOL[hashLogin(login) % LEGACY_SURPRISE_POOL.length];
}
