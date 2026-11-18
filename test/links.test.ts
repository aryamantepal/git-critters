import assert from "node:assert/strict";
import { test } from "node:test";
import { addLink, createRepoLink, cronFor, editLink, isValidUsername, WORKFLOW_PATH, workflowFile } from "../src/site/links.ts";

test("the link opens the new-file page with the automatic hatchling workflow filled in", () => {
  const url = new URL(addLink("sam", "main"));
  assert.equal(url.origin + url.pathname, "https://github.com/sam/sam/new/main");
  assert.equal(url.searchParams.get("filename"), WORKFLOW_PATH);
  assert.equal(url.searchParams.get("value"), workflowFile("sam"));
  assert.equal(url.searchParams.get("message"), "Add a git-critter to my profile");
});

test("the generated workflow has no species, egg or colour selection", () => {
  const file = workflowFile();
  assert.ok(file.includes(`paths: [${WORKFLOW_PATH}]`));
  assert.match(file, /contents: write/);
  assert.match(file, /uses: aryamantepal\/git-critters@v1/);
  assert.match(file, /^          activity: true$/m);
  assert.doesNotMatch(file, /^          (critter|egg|colour):/m);
});

test("the workflow runs nightly, on demand and one run at a time", () => {
  const file = workflowFile();
  assert.match(file, /^  workflow_dispatch:$/m);
  assert.match(file, /^  schedule:\n    - cron: "37 0 \* \* \*" # after midnight UTC/m);
  assert.match(file, /^concurrency: critter$/m);
});

test("the no-login workflow keeps the README's fixed schedule", () => {
  assert.equal(workflowFile(), workflowFile(undefined));
  assert.match(workflowFile(), /- cron: "37 0 \* \* \*"/);
});

test("a login's cron is deterministic, case-insensitive, and inside the post-midnight window", () => {
  for (const login of ["sam", "aryamantepal", "Zoe-9", "a-rather-long-github-username-of-39-char"]) {
    const cron = cronFor(login);
    assert.equal(cron, cronFor(login), login);
    assert.equal(cron, cronFor(login.toUpperCase()), login);
    assert.equal(cron, cronFor(login.toLowerCase()), login);
    const match = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(cron)!;
    const minute = Number(match[1]);
    const hour = Number(match[2]);
    assert.ok(hour >= 0 && hour <= 2, cron);
    assert.ok(minute >= 0 && minute <= 59, cron);
    assert.ok(!(minute === 0 || minute === 30), `avoids the busy minute: ${cron}`);
    const total = hour * 60 + minute;
    assert.ok(total >= 15 && total <= 175, cron);
    assert.match(workflowFile(login), new RegExp(`- cron: "${cron.replace(/[*]/g, "\\*")}"`));
  }
});

test("crons spread across the window instead of piling onto one minute", () => {
  const crons = new Set(Array.from({ length: 500 }, (_, n) => cronFor(`user-${n}`)));
  assert.ok(crons.size > 100, `${crons.size} distinct schedules for 500 logins`);
  const hours = new Set([...crons].map((cron) => Number(cron.split(" ")[1])));
  assert.deepEqual([...hours].sort(), [0, 1, 2]);
});

test("the automatic hatchling link stays well under what browsers and GitHub accept", () => {
  const link = addLink("a-rather-long-github-username-of-39-char", "main");
  assert.ok(link.length < 2000, `${link.length} characters`);
});

test("a default branch with a slash in it survives", () => {
  assert.match(addLink("sam", "release/1"), /\/new\/release%2F1\?/);
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
