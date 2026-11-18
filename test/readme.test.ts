import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { critterBlock, hasOtherCreature, README_CRITTER_ALT, retargetCritterSrc, withCritterBlock } from "../src/action/readme.ts";

const block = critterBlock("critter.gif");

test("the starter block is a centred image with neutral alt text and a credit", () => {
  assert.match(block, /<p align="center">/);
  assert.match(block, /src="critter\.gif"/);
  assert.match(block, /width="720"/);
  assert.ok(block.includes(`alt="${README_CRITTER_ALT}"`));
  assert.match(block, /git-critters<\/a>/);
});

test("clicking the critter image goes to the site, not the raw blob viewer", () => {
  assert.match(block, /<a href="https:\/\/critters\.aryamantepal\.com">\n {4}<img src="critter\.gif"/);
  assert.ok(!/\[<img|\]\(critter\.gif\)/.test(block), "the image must be wrapped in a link, not Markdown-linked");
});

test("the credit links the repo and the onboarding site", () => {
  assert.match(block, /Made with <a href="https:\/\/github\.com\/aryamantepal\/git-critters">git-critters<\/a> \| <a href="https:\/\/critters\.aryamantepal\.com">Hatch your own<\/a>/);
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

describe("retargeting the block's image when the GIF moves to an asset branch", () => {
  const url = "https://raw.githubusercontent.com/sam/sam/critter-output/critter.gif";

  test("rewrites only the src inside the marked block", () => {
    const readme = `# Hello\n\n${block}\n\n<img src="critter.gif" /> elsewhere\n`;
    const moved = retargetCritterSrc(readme, "critter.gif", url);
    assert.ok(moved.includes(`src="${url}"`));
    assert.ok(moved.includes('<img src="critter.gif" /> elsewhere'), "images outside the block stay put");
    assert.equal(moved.match(/critter\.gif/g)?.length, 2, "the URL still ends in critter.gif, plus the outside image");
    // And the block is still preserved byte for byte afterwards.
    assert.equal(withCritterBlock(moved, critterBlock(url)), moved);
  });

  test("leaves READMEs without a block, or with another src, alone", () => {
    assert.equal(retargetCritterSrc("# Hi\n", "critter.gif", url), "# Hi\n");
    const other = block.replace('src="critter.gif"', 'src="other.gif"');
    assert.equal(retargetCritterSrc(`${other}\n`, "critter.gif", url), `${other}\n`);
  });
});
