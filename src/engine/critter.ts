import { DEFAULT_TRAITS, traitsKey } from "./traits.ts";
import type { Traits } from "./traits.ts";

/** How much a critter's logical pixels are scaled up in the GIF. */
export const SCALE = 4;

export interface Colourway<Name extends string = string> {
  id: string;
  name: string;
  colours: Readonly<Record<Name, string>>;
}

export interface CritterDefinition<Name extends string = string> {
  /** The value people put in their workflow, such as `dragon`. */
  id: string;
  name: string;
  /** One short line for the picker. */
  blurb: string;
  /** Alt text for the image in someone's README. */
  alt: string;
  width: number;
  height: number;
  frames: number;
  delayMs: number;
  /** A flattering frame, used for thumbnails. */
  poster: number;
  /** Colour names in palette order. Palette index 0 is transparent, these start at 1. */
  colourNames: readonly Name[];
  colourways: readonly Colourway<Name>[];
  /** The colour that sets the body's hue when a colourway is built from a language. */
  bodyColour: Name;
  /** Colours that take the second language's hue: wings, gills, tentacles, sparkles. */
  accentColours: readonly Name[];
  /** Colours that never change with a language: eyes, white, cheeks. */
  fixedColours: readonly Name[];
  /**
   * Colours that reach the edge of the silhouette. GIF transparency is all or
   * nothing, so these have to show on light and dark pages in every colourway.
   */
  edgeColours: readonly Name[];
  /**
   * Draw one frame as palette indexes, width × height. The result must depend only
   * on the index and traits, and every motion must complete whole cycles over
   * `frames`, so the last frame flows into the first.
   */
  draw(index: number, traits: Traits): Uint8Array;
}

export interface Critter extends Omit<CritterDefinition, "draw"> {
  /** Draw one frame. Traits default to `DEFAULT_TRAITS`. */
  draw(index: number, traits?: Traits): Uint8Array;
  /**
   * The same as draw, but remembers each frame once it has been drawn. Only the
   * most recent traits are kept.
   */
  frame(index: number, traits?: Traits): Uint8Array;
}

export function defineCritter<Name extends string>(definition: CritterDefinition<Name>): Critter {
  let cacheKey = "";
  let cache: (Uint8Array | undefined)[] = [];
  return {
    ...(definition as CritterDefinition),
    draw: (index, traits = DEFAULT_TRAITS) => definition.draw(index, traits),
    frame(index, traits = DEFAULT_TRAITS) {
      const key = traitsKey(traits);
      if (key !== cacheKey) {
        cache = new Array(definition.frames);
        cacheKey = key;
      }
      const i = ((index % definition.frames) + definition.frames) % definition.frames;
      return (cache[i] ??= definition.draw(i, traits));
    },
  };
}

/** Palette indexes by colour name, for use while drawing. */
export function colourIndexes<Name extends string>(names: readonly Name[]): Readonly<Record<Name, number>> {
  return Object.fromEntries(names.map((name, i) => [name, i + 1])) as Record<Name, number>;
}

/** The RGB triples for a colourway, with the transparent colour first. */
export function paletteOf(critter: Critter, colourway: string | Colourway): Uint8Array {
  const way = typeof colourway === "string" ? critter.colourways.find((c) => c.id === colourway) : colourway;
  if (!way) throw new Error(`${critter.name} has no colourway "${colourway}"`);
  const palette = new Uint8Array((critter.colourNames.length + 1) * 3);
  critter.colourNames.forEach((name, i) => {
    const hex = way.colours[name];
    for (let c = 0; c < 3; c++) {
      palette[(i + 1) * 3 + c] = Number.parseInt(hex.slice(1 + c * 2, 3 + c * 2), 16);
    }
  });
  return palette;
}
