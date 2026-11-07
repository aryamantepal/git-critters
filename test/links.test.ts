import assert from "node:assert/strict";
import { test } from "node:test";
import { critters } from "../src/critters/index.ts";
import {
  addLink,
  createRepoLink,
  editLink,
  isValidUsername,
  WORKFLOW_PATH,
  workflowFile,
} from "../src/site/links.ts";

test("the link opens the new-file page with the workflow filled in", () => {
  const url = new URL(addLink("sam", "main", "ghost", "mint", false));
  assert.equal(url.origin + url.pathname, "https://github.com/sam/sam/new/main");
  assert.equal(url.searchParams.get("filename"), WORKFLOW_PATH);
  const file = url.searchParams.get("value") ?? "";
  assert.equal(file, workflowFile("ghost", "mint", false));
  assert.match(file, /critter: ghost\n/);
  assert.match(file, /colour: mint\n/);
});

test("the workflow runs when it's committed, and can write to the repo", () => {
  const file = workflowFile("dragon", "ember", false);
  assert.ok(file.includes(`paths: [${WORKFLOW_PATH}]`));
  assert.match(file, /contents: write/);
  assert.match(file, /uses: aryamantepal\/git-critters@v1/);
});

test("the workflow also runs each night, one run at a time, drawing from activity", () => {
  const file = workflowFile("dragon", "languages", false);
  assert.match(file, /^  workflow_dispatch:$/m);
  assert.match(file, /^  schedule:\n    - cron: "37 0 \* \* \*" # just after midnight UTC/m);
  assert.match(file, /^concurrency: critter$/m);
  assert.match(file, /^          activity: true$/m);
  assert.match(file, /^          critter: dragon\n          colour: languages\n$/m);
  assert.ok(file.trimEnd().split("\n").slice(-2).join("\n").includes("colour: languages"), "swap lines stay last");
});

test("with the egg on, egg: true sits above the last two lines, and with it off the file is unchanged", () => {
  const off = workflowFile("dragon", "languages", false);
  const on = workflowFile("dragon", "languages", true);
  assert.ok(!off.includes("egg"));
  assert.equal(on, off.replace("          activity: true\n", "          activity: true\n          egg: true\n"));
  assert.match(on, /^          activity: true\n          egg: true\n          critter: dragon\n          colour: languages\n$/m);
  assert.deepEqual(on.trimEnd().split("\n").slice(-2), ["          critter: dragon", "          colour: languages"]);
});

test("a surprise is a workflow with the egg on and nothing that names a species", () => {
  const file = workflowFile("surprise", "languages", true);
  assert.match(file, /^          egg: true\n          critter: surprise\n          colour: languages\n$/m);
  for (const critter of critters) assert.ok(!file.includes(critter.id), critter.id);
  const url = new URL(addLink("sam", "main", "surprise", "languages", true));
  assert.equal(url.searchParams.get("value"), file);
  assert.ok(!(url.searchParams.get("message") ?? "").match(/dragon|axolotl|jellyfish|ghost/));
});

test("every critter's link stays well under what browsers and GitHub accept", () => {
  for (const critter of critters) {
    for (const way of ["languages", ...critter.colourways.map((w) => w.id)]) {
      const link = addLink("a-rather-long-github-username-of-39-char", "main", critter.id, way, true);
      assert.ok(link.length < 2000, `${link.length} characters`);
    }
  }
});

test("a default branch with a slash in it survives", () => {
  assert.match(addLink("sam", "release/1", "ghost", "mint", false), /\/new\/release%2F1\?/);
  assert.match(editLink("sam", "release/1"), /\/edit\/release%2F1\//);
});

test("the create-repo link fills in a public repo named after the account", () => {
  const url = new URL(createRepoLink("sam"));
  assert.equal(url.pathname, "/new");
  assert.equal(url.searchParams.get("name"), "sam");
  assert.equal(url.searchParams.get("visibility"), "public");
});

test("usernames follow GitHub's rules", () => {
  for (const good of ["sam", "Sam-1", "a", "a".repeat(39)]) assert.ok(isValidUsername(good), good);
  for (const bad of ["", "-sam", "sam-", "sa m", "../etc", "sam/sam", "a".repeat(40)]) {
    assert.ok(!isValidUsername(bad), bad);
  }
});
