import assert from "node:assert/strict";
import { test } from "node:test";
import { critterBlock, withCritterBlock } from "../src/action/readme.ts";
import { dragon } from "../src/critters/dragon.ts";
import { ghost } from "../src/critters/ghost.ts";

const block = critterBlock(dragon, "critter.gif");

test("the block is a centred image with alt text and a credit", () => {
  assert.match(block, /<p align="center">/);
  assert.match(block, /src="critter\.gif"/);
  assert.match(block, /width="720"/);
  assert.ok(block.includes(`alt="${dragon.alt}"`));
  assert.match(block, /git-critters<\/a>/);
});

test("goes above what's already in a README, leaving it untouched", () => {
  const readme = "# Hello\n\nI like **bold** things.\n";
  assert.equal(withCritterBlock(readme, block), `${block}\n\n${readme}`);
});

test("fills an empty README", () => {
  assert.equal(withCritterBlock("", block), `${block}\n`);
  assert.equal(withCritterBlock("  \n", block), `${block}\n`);
});

test("swaps an earlier critter in place instead of adding another", () => {
  const before = `# Hello\n\n${block}\n\nThe rest.\n`;
  const swapped = critterBlock(ghost, "critter.gif");
  const after = withCritterBlock(before, swapped);
  assert.equal(after, `# Hello\n\n${swapped}\n\nThe rest.\n`);
  assert.equal(after.match(/git-critters:start/g)?.length, 1);
});

test("adding the same critter twice changes nothing", () => {
  const once = withCritterBlock("# Hello\n", block);
  assert.equal(withCritterBlock(once, block), once);
});

const koi = [
  '<p align="center">',
  '  <img src="koi/koi.gif" width="256" alt="My koi" />',
  "  <br />",
  '  <sub>Drawn by <a href="https://github.com/yalongwastaken/git-koi">git-koi</a></sub>',
  "</p>",
].join("\n");

test("takes the place of a git-koi koi, leaving the rest untouched", () => {
  const before = `<h1 align="center">Hi</h1>\n\n${koi}\n\nAbout me.\n\n<p>A photo <img src="me.png" /></p>\n`;
  assert.equal(
    withCritterBlock(before, block),
    `<h1 align="center">Hi</h1>\n\n${block}\n\nAbout me.\n\n<p>A photo <img src="me.png" /></p>\n`,
  );
});

test("an earlier critter wins over a koi, so the koi stays put", () => {
  const before = `${koi}\n\n${block}\n`;
  const swapped = critterBlock(ghost, "critter.gif");
  assert.equal(withCritterBlock(before, swapped), `${koi}\n\n${swapped}\n`);
});

test("a link to git-koi without its image is left alone", () => {
  const readme = '<p>I like <a href="https://github.com/yalongwastaken/git-koi">git-koi</a>.</p>\n';
  assert.equal(withCritterBlock(readme, block), `${block}\n\n${readme}`);
});
