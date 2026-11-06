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
