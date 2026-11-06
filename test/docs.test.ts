// The options are listed by hand in two places, so make sure they keep up.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { critters } from "../src/critters/index.ts";

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
