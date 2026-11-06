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

/** Put the block at the top of a README, or swap it in place if one is already there. */
export function withCritterBlock(readme: string, block: string): string {
  const start = readme.indexOf(START);
  const end = readme.indexOf(END);
  if (start !== -1 && end > start) {
    return readme.slice(0, start) + block + readme.slice(end + END.length);
  }
  return readme.trim() === "" ? `${block}\n` : `${block}\n\n${readme}`;
}
