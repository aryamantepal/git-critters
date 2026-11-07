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

/**
 * The critters a surprise can hatch into. This is its own list, not derived from
 * `critters`, and must never be reordered or extended in place: that would change
 * the critter everyone with a surprise has already been promised.
 */
export const SURPRISE_POOL: readonly string[] = Object.freeze(["dragon", "axolotl", "jellyfish", "ghost"]);

/** FNV-1a over the login in lower case, so `Sam` and `sam` get the same surprise. */
export function surpriseFor(login: string): string {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(login.toLowerCase())) {
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  }
  return SURPRISE_POOL[hash % SURPRISE_POOL.length];
}
