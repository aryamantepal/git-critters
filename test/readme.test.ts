import assert from "node:assert/strict";
import { test } from "node:test";
import { critterBlock, hasOtherCreature, README_CRITTER_ALT, withCritterBlock } from "../src/action/readme.ts";

const block = critterBlock("critter.gif");

test("the starter block is a centred image with neutral alt text and a credit", () => {
  assert.match(block, /<p align="center">/);
  assert.match(block, /src="critter\.gif"/);
  assert.match(block, /width="720"/);
  assert.ok(block.includes(`alt="${README_CRITTER_ALT}"`));
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

test("preserves a user's marked critter block byte for byte", () => {
  const customised = block.replace('align="center"', 'align="left"').replace('width="720"', 'width="180"');
  assert.notEqual(customised, block);
  const before = `# Hello\n\n${customised}\n\nThe rest.\n`;
  const after = withCritterBlock(before, block);
  assert.equal(after, before);
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
  assert.equal(withCritterBlock(before, block), before);
});

test("a link to git-koi without its image is left alone", () => {
  const readme = '<p>I like <a href="https://github.com/yalongwastaken/git-koi">git-koi</a>.</p>\n';
  assert.equal(withCritterBlock(readme, block), `${block}\n\n${readme}`);
});

test("knows when a critter would replace a koi, but not when a critter is already there", () => {
  assert.ok(hasOtherCreature(`# Hi\n\n${koi}\n`));
  assert.ok(!hasOtherCreature(`${koi}\n\n${block}\n`));
  assert.ok(!hasOtherCreature("# Hi\n"));
});
