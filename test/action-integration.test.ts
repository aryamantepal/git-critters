import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { critterBlock, withCritterBlock } from "../src/action/readme.ts";

const action = fileURLToPath(new URL("../dist/action.cjs", import.meta.url));
const bot = "github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>";

function fixture(t: { after: (fn: () => void) => void }) {
  const root = mkdtempSync(join(tmpdir(), "critter-action-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  // Exclude inherited identities, inputs, hooks and Git configuration from the test.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^(GIT_|GITHUB_|INPUT_|NODE_OPTIONS$|EMAIL$)/.test(key)));
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_ALLOW_PROTOCOL: "file", GIT_TERMINAL_PROMPT: "0" });
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const remote = join(root, "remote.git");
  const seed = join(root, "seed");
  const checkout = join(root, "checkout");
  git(root, "init", "--bare", "--initial-branch=main", remote);
  git(root, "clone", remote, seed);
  const readme = withCritterBlock("# Profile\n", critterBlock("https://raw.githubusercontent.com/sam/sam/critter-output/critter.gif"));
  writeFileSync(join(seed, "README.md"), readme);
  git(seed, "add", "README.md");
  git(seed, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", "commit", "-m", "Profile");
  git(seed, "push", "origin", "main");
  git(root, "clone", remote, checkout);
  const head = git(checkout, "rev-parse", "HEAD");
  const preload = join(root, "fetch.cjs");
  writeFileSync(preload, 'globalThis.fetch = async () => { throw new Error("simulated API failure"); };\n');
  const run = (inputs: Record<string, string> = {}) => {
    const result = spawnSync(process.execPath, ["--require", preload, action], {
      cwd: checkout, encoding: "utf8", env: { ...env, GITHUB_REPOSITORY: "sam/sam", INPUT_BRANCH: "critter-output", INPUT_CRITTER: "fox", INPUT_ACTIVITY: "false", ...inputs },
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return result.stdout;
  };
  return { root, remote, seed, checkout, readme, head, git, run };
}

test("asset action sets bot identity on a fresh checkout even when README is unchanged", (t) => {
  const f = fixture(t);
  assert.throws(() => f.git(f.checkout, "config", "--get", "user.name"));
  assert.throws(() => f.git(f.checkout, "config", "--get", "user.email"));
  f.run();
  assert.equal(readFileSync(join(f.checkout, "README.md"), "utf8"), f.readme);
  assert.equal(f.git(f.checkout, "rev-parse", "HEAD"), f.head);
  assert.equal(f.git(f.remote, "rev-parse", "main"), f.head);
  assert.equal(f.git(f.remote, "show", "-s", "--format=%an <%ae>|%cn <%ce>", "critter-output"), `${bot}|${bot}`);
  assert.equal(f.git(f.remote, "rev-list", "--count", "critter-output"), "1");
  assert.equal(f.git(f.remote, "ls-tree", "--name-only", "critter-output"), "critter.gif");
  assert.equal(f.git(f.remote, "rev-parse", "critter-output:critter.gif"), f.git(f.checkout, "hash-object", "critter.gif"));
  assert.equal(readFileSync(join(f.checkout, "critter.gif")).subarray(0, 6).toString(), "GIF89a");
});

for (const existing of [true, false]) {
  test(`API failure ${existing ? "preserves the remote asset" : "skips first install"} without rendering or pushing`, (t) => {
    const f = fixture(t);
    if (existing) {
      f.run();
      // Re-clone: the asset GIF is absent on a normal default-branch checkout.
      rmSync(f.checkout, { recursive: true });
      f.git(f.root, "clone", f.remote, f.checkout);
    }
    const hook = join(f.checkout, ".git/hooks/pre-push");
    writeFileSync(hook, '#!/bin/sh\ntouch .git/push-attempted\nexit 1\n');
    chmodSync(hook, 0o755);
    const refs = f.git(f.remote, "show-ref");
    const asset = existing ? f.git(f.remote, "rev-parse", "critter-output:critter.gif") : undefined;
    const output = f.run({ INPUT_ACTIVITY: "true", INPUT_LOGIN: "sam" });
    assert.match(output, /simulated API failure/);
    assert.match(output, /trying again at the next run/);
    assert.equal(existsSync(join(f.checkout, "critter.gif")), false);
    assert.equal(existsSync(join(f.checkout, ".git/push-attempted")), false);
    assert.equal(readFileSync(join(f.checkout, "README.md"), "utf8"), f.readme);
    assert.equal(f.git(f.checkout, "rev-parse", "HEAD"), f.head);
    assert.equal(f.git(f.checkout, "status", "--porcelain"), "");
    assert.equal(f.git(f.remote, "show-ref"), refs);
    if (existing) assert.equal(f.git(f.remote, "rev-parse", "critter-output:critter.gif"), asset);
  });
}
