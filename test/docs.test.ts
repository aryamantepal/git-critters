// The options are listed by hand in two places, so make sure they keep up.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { crc32, deflateSync, inflateSync } from "node:zlib";
import { HATCH_AFTER } from "../src/activity/egg.ts";
import { LIVELY_FROM, MARKS_FROM, STAGE_FROM } from "../src/activity/traits.ts";
import { critters } from "../src/critters/index.ts";
import { workflowFile } from "../src/site/links.ts";
import { buildOgPng, buildShowcaseGif, encodePng, OG_HEIGHT, OG_WIDTH, SHOWCASE_HEIGHT, SHOWCASE_WIDTH } from "../scripts/showcase.ts";

const readme = readFileSync("README.md", "utf8");
const action = readFileSync("action.yml", "utf8");

for (const critter of critters) {
  test(`the docs list ${critter.id} and its colourways`, () => {
    const row = readme.split("\n").find((line) => line.startsWith(`| \`${critter.id}\``));
    assert.ok(row, "README's table has no row for it");
    for (const way of critter.colourways) assert.ok(row.includes(`\`${way.id}\``), way.id);
    assert.ok(action.includes(critter.id), "action.yml doesn't mention it");
  });
}

test("the README's example is the workflow the site generates", () => {
  const example = /```yaml\n([\s\S]*?)```/.exec(readme)?.[1];
  assert.equal(example, workflowFile());
});

test("the README says when an egg hatches, with the number the code uses", () => {
  const row = readme.split("\n").find((line) => line.startsWith("| Contributions since")) ?? "";
  assert.ok(row.includes(`hatches after ${HATCH_AFTER}`), "the activity table has no row for the egg");
  const numbers = [...readme.matchAll(/hatch(?:es)? after (\d+) contributions/g)].map((m) => Number(m[1]));
  assert.ok(numbers.length > 0);
  assert.ok(numbers.every((n) => n === HATCH_AFTER), numbers.join(", "));
});

test("the README's table of activity states the thresholds the code uses", () => {
  const row = (start: string) => readme.split("\n").find((line) => line.startsWith(`| ${start}`)) ?? "";
  const size = row("Lifetime contributions");
  for (const from of STAGE_FROM) assert.ok(size.includes(`from ${from.toLocaleString("en-US")}`), `size ${from}`);
  const marks = row("Longest streak");
  for (const from of MARKS_FROM) assert.ok(marks.includes(`from ${from}`), `marks ${from}`);
  assert.ok(row("Contributions yesterday").includes(`lively from ${LIVELY_FROM}`));
});

test("the preview site has a browser icon", () => {
  const html = readFileSync("site/index.html", "utf8");
  assert.ok(!html.includes("R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=="), "placeholder blank GIF remains");
  assert.ok(html.includes('href="favicon.svg"'));
  assert.ok(existsSync("site/favicon.svg"));
  assert.ok(existsSync("site/favicon.ico"));
  assert.ok(existsSync("site/favicon.png"));
});

test("the preview site has searchable previews without an install-time picker", () => {
  const html = readFileSync("site/index.html", "utf8");
  assert.ok(!html.includes('id="critter-search"'), "the species search should be gone");
  assert.ok(!html.includes('id="critters"'), "the species picker should be gone");
  assert.ok(html.includes('id="hatchling-search"'), "missing the possible-hatchling search");
  assert.ok(html.includes('id="possible-hatchlings"'), "missing the hatchling preview gallery");
  assert.ok(html.includes('id="added-dialog"'), "missing installation confirmation dialog");
  assert.ok(html.includes('id="added-egg"'), "the confirmation should show the egg");
});

function pngContent(bytes: Uint8Array): { ihdr: Buffer; scanlines: Buffer } {
  const png = Buffer.from(bytes);
  assert.ok(png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "not a PNG");
  let ihdr: Buffer | undefined;
  const idat: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    assert.ok(offset + 12 <= png.length, "truncated PNG chunk");
    const length = png.readUInt32BE(offset);
    const end = offset + 12 + length;
    assert.ok(end <= png.length, "truncated PNG chunk data");
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, end - 4);
    if (type === "IHDR") ihdr = data;
    if (type === "IDAT") idat.push(data);
    offset = end;
  }
  assert.ok(ihdr, "missing IHDR");
  assert.equal(ihdr.length, 13);
  assert.ok(idat.length > 0, "missing IDAT");
  // The encoder uses filter 0, so inflated scanlines compare pixels directly.
  // Deflate bytes can differ across zlib versions and IDAT chunk boundaries.
  return { ihdr, scanlines: inflateSync(Buffer.concat(idat)) };
}

test("the social card is a 1200x630 PNG with the pixels the script renders", () => {
  const png = readFileSync("site/og.png");
  assert.ok(png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "not a PNG");
  assert.equal(png.readUInt32BE(16), OG_WIDTH);
  assert.equal(png.readUInt32BE(20), OG_HEIGHT);
  assert.deepEqual(pngContent(png), pngContent(buildOgPng()), "site/og.png is stale; run npm run showcase");
});

test("PNG comparison ignores compression and multiple IDAT chunk boundaries", () => {
  const original = Buffer.from(encodePng(2, 1, new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255])));
  const content = pngContent(original);
  const compressed = deflateSync(content.scanlines, { level: 0 });
  const chunk = (data: Buffer): Buffer => {
    const out = Buffer.alloc(data.length + 12);
    out.writeUInt32BE(data.length, 0);
    out.write("IDAT", 4);
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, -4)), out.length - 4);
    return out;
  };
  const recompressed = Buffer.concat([
    original.subarray(0, 33), // signature and IHDR
    chunk(compressed.subarray(0, 1)), // split even the zlib header across chunks
    chunk(compressed.subarray(1)),
    original.subarray(-12), // IEND
  ]);
  assert.notDeepEqual(recompressed, original);
  assert.deepEqual(pngContent(recompressed), content);
});

test("PNG comparison detects changed pixels and IHDR dimensions", () => {
  const pixels = new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255]);
  const original = pngContent(encodePng(2, 1, pixels));
  assert.notDeepEqual(pngContent(encodePng(1, 2, pixels)).ihdr, original.ihdr);
  pixels[0]++;
  const changed = pngContent(encodePng(2, 1, pixels));
  assert.deepEqual(changed.ihdr, original.ihdr);
  assert.notDeepEqual(changed.scanlines, original.scanlines);
});

test("the site declares OpenGraph and Twitter card tags with absolute URLs", () => {
  const html = readFileSync("site/index.html", "utf8");
  for (const tag of [
    '<meta property="og:type" content="website"',
    '<meta property="og:url" content="https://critters.aryamantepal.com/"',
    '<meta property="og:title" content="git-critters"',
    '<meta property="og:description"',
    '<meta property="og:image" content="https://critters.aryamantepal.com/og.png"',
    '<meta property="og:image:width" content="1200"',
    '<meta property="og:image:height" content="630"',
    '<meta property="og:image:alt"',
    '<meta name="twitter:card" content="summary_large_image"',
    '<meta name="twitter:title" content="git-critters"',
    '<meta name="twitter:description"',
    '<meta name="twitter:image" content="https://critters.aryamantepal.com/og.png"',
  ]) {
    assert.ok(html.includes(tag), tag);
  }
});
