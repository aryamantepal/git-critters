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

/** The full pool used by the site's new automatic hatchling flow. */
export const HATCHLING_POOL: readonly string[] = Object.freeze([
  "dragon",
  "axolotl",
  "jellyfish",
  "ghost",
  "robot",
  "cat",
  "frog",
  "mushroom",
  "turtle",
  "bat",
]);

/**
 * The original `critter: surprise` pool. Never change this list: existing workflows
 * still use it, and changing it would silently replace their promised hatchling.
 */
export const LEGACY_SURPRISE_POOL: readonly string[] = Object.freeze(["dragon", "axolotl", "jellyfish", "ghost"]);

function hashLogin(login: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(login.toLowerCase())) {
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  }
  return hash;
}

/** FNV-1a over the login in lower case, so `Sam` and `sam` get the same hatchling. */
export function hatchlingFor(login: string): string {
  return HATCHLING_POOL[hashLogin(login) % HATCHLING_POOL.length];
}

/** Preserve the mapping used by workflows that explicitly say `critter: surprise`. */
export function legacySurpriseFor(login: string): string {
  return LEGACY_SURPRISE_POOL[hashLogin(login) % LEGACY_SURPRISE_POOL.length];
}
