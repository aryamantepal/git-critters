import type { Critter } from "../engine/critter.ts";
import { SCALE } from "../engine/critter.ts";

const START = "<!-- git-critters:start -->";
const END = "<!-- git-critters:end -->";

export const KIT_URL = "https://github.com/aryamantepal/git-critters";

function escapeAttribute(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

export function critterBlock(critter: Critter, gifPath: string): string {
  return [
    START,
    '<p align="center">',
    `  <img src="${escapeAttribute(gifPath)}" width="${critter.width * SCALE}" alt="${escapeAttribute(critter.alt)}" />`,
    "  <br />",
    `  <sub>Made with <a href="${KIT_URL}">git-critters</a></sub>`,
    "</p>",
    END,
  ].join("\n");
}

/** Repos whose credit marks a creature this one takes the place of. */
export const OTHER_CREATURES = ["github.com/yalongwastaken/git-koi"];

/** A paragraph holding an image and a credit to one of OTHER_CREATURES, such as git-koi's. */
function otherCreature(readme: string): { start: number; end: number } | null {
  for (const match of readme.matchAll(/<p\b[^>]*>[\s\S]*?<\/p>/gi)) {
    const html = match[0];
    if (/<img\b/i.test(html) && OTHER_CREATURES.some((repo) => html.includes(repo))) {
      return { start: match.index, end: match.index + html.length };
    }
  }
  return null;
}

/** Whether adding a critter would take the place of another creature, for a README in Markdown or GitHub's HTML. */
export function hasOtherCreature(readme: string): boolean {
  return !(readme.includes(START) && readme.includes(END)) && otherCreature(readme) !== null;
}

/** What to tell someone whose koi a critter replaces, since this can't remove another tool's workflow for them. */
export const OTHER_CREATURE_LEFTOVERS =
  "This takes the place of your git-koi koi. Its workflow will keep redrawing a GIF nobody sees, so delete .github/workflows/koi.yml and the koi folder.";

/**
 * Swap the block in place if one is already there, or take the spot of another
 * creature like git-koi's, or else put it at the top of the README.
 */
export function withCritterBlock(readme: string, block: string): string {
  const start = readme.indexOf(START);
  const end = readme.indexOf(END);
  if (start !== -1 && end > start) {
    return readme.slice(0, start) + block + readme.slice(end + END.length);
  }
  const other = otherCreature(readme);
  if (other) return readme.slice(0, other.start) + block + readme.slice(other.end);
  return readme.trim() === "" ? `${block}\n` : `${block}\n\n${readme}`;
}
