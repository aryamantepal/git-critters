// The options are listed by hand in two places, so make sure they keep up.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { HATCH_AFTER } from "../src/activity/egg.ts";
import { LIVELY_FROM, MARKS_FROM, STAGE_FROM } from "../src/activity/traits.ts";
import { critters } from "../src/critters/index.ts";
import { workflowFile } from "../src/site/links.ts";

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
