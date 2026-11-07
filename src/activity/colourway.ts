import type { Colourway, Critter } from "../engine/critter.ts";
import { contrast, DARK_PAGE, LIGHT_PAGE, MIN_EDGE_CONTRAST, showsOnBothPages } from "../engine/contrast.ts";
import { LANGUAGE_COLOURS } from "./languages.ts";

export const LANGUAGES_COLOURWAY = "languages";

/** Hue in degrees, then saturation and lightness from 0 to 1. */
type Hsl = readonly [number, number, number];

/** Greys such as C's #555555 have no hue to take, so a critter keeps its own colours. */
const MIN_SATURATION = 0.12;

function toHsl(hex: string): Hsl {
  const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255);
  const high = Math.max(r, g, b);
  const low = Math.min(r, g, b);
  const l = (high + low) / 2;
  if (high === low) return [0, 0, l];
  const d = high - low;
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = high === r ? ((g - b) / d) % 6 : high === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

function toRgb([h, s, l]: Hsl): number[] {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - chroma / 2;
  const sextant = Math.floor(h / 60) % 6;
  const [r, g, b] = [
    [chroma, x, 0],
    [x, chroma, 0],
    [0, chroma, x],
    [0, x, chroma],
    [x, 0, chroma],
    [chroma, 0, x],
  ][sextant];
  return [r, g, b].map((v) => Math.round((v + m) * 255));
}

function toHex(hsl: Hsl): string {
  return `#${toRgb(hsl)
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`;
}

/** How far to turn hues so that `reference` lands on the hue of a language. */
function turnFor(language: string | undefined, reference: string): number {
  const target = language ? LANGUAGE_COLOURS[language] : undefined;
  if (!target) return 0;
  const [hue, saturation] = toHsl(target);
  return saturation < MIN_SATURATION ? 0 : hue - toHsl(reference)[0];
}

/** Move lightness the least that makes a colour show on both pages again. */
function nudgeToShow(hsl: Hsl): Hsl {
  let [h, s, l] = hsl;
  const margin = MIN_EDGE_CONTRAST * 1.02;
  for (let step = 0; step < 100; step++) {
    const rgb = toRgb([h, s, l]);
    if (contrast(rgb, LIGHT_PAGE) < margin) l = Math.max(0, l - 0.01);
    else if (contrast(rgb, DARK_PAGE) < margin) l = Math.min(1, l + 0.01);
    else break;
  }
  return [h, s, l];
}

/**
 * A critter's first colourway with its hues turned to a person's languages: the
 * body takes the top language's hue and the accents take the second's, or the top's
 * if there's only one. Lightness and saturation stay as they were, except that
 * the colours on the edge are nudged until they show on both pages, since the
 * same lightness can be much brighter in some hues.
 */
export function languageColourway(critter: Critter, languages: readonly string[]): Colourway {
  const base = critter.colourways[0];
  const [top, second = top] = languages;
  const bodyTurn = turnFor(top, base.colours[critter.bodyColour]);
  const accentTurn = turnFor(second, base.colours[critter.accentColours[0]]);
  const colours: Record<string, string> = {};
  for (const name of critter.colourNames) {
    const original = base.colours[name];
    const turn = critter.fixedColours.includes(name) ? 0 : critter.accentColours.includes(name) ? accentTurn : bodyTurn;
    if (turn === 0) {
      colours[name] = original;
      continue;
    }
    const [h, s, l] = toHsl(original);
    let turned: Hsl = [(h + turn + 360) % 360, s, l];
    if (critter.edgeColours.includes(name) && !showsOnBothPages(toRgb(turned), 1.02)) turned = nudgeToShow(turned);
    colours[name] = toHex(turned);
  }
  return { id: LANGUAGES_COLOURWAY, name: "My languages", colours };
}
