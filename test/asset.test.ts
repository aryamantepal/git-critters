import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { assetRawUrl, pushAssetBranch } from "../src/action/asset.ts";

/** A git runner that answers plumbing commands and records every call. */
function fakeGit() {
  const calls: { args: string[]; env?: Record<string, string> }[] = [];
  const run = (args: string[], env?: Record<string, string>): string => {
    calls.push({ args, env });
    if (args[0] === "write-tree") return "tree123\n";
    if (args[0] === "commit-tree") return "abc456\n";
    return "";
  };
  return { calls, run };
}

describe("pushing the GIF to an asset branch", () => {
  const push = { gifPath: "critter.gif", branch: "critter-output", message: "critter: draw the fox for 2026-11-17", date: new Date("2026-11-18T15:04:12Z") };

  test("builds a parentless commit holding only the GIF and force-pushes it", () => {
    const { calls, run } = fakeGit();
    const commit = pushAssetBranch(push, run);
    assert.equal(commit, "abc456");
    assert.deepEqual(
      calls.map(({ args }) => args),
      [
        ["read-tree", "--empty"],
        ["add", "--force", "--", "critter.gif"],
        ["write-tree"],
        ["commit-tree", "tree123", "-m", "critter: draw the fox for 2026-11-17"],
        ["push", "--force", "origin", "abc456:refs/heads/critter-output"],
      ],
    );
    // The commit is parentless: no -p anywhere.
    assert.ok(!calls.some(({ args }) => args.includes("-p")));
    // The throwaway index and the fixed commit dates make same-day reruns the same commit.
    const index = calls[0].env?.GIT_INDEX_FILE;
    assert.ok(index);
    for (const call of calls.slice(0, 4)) assert.equal(call.env?.GIT_INDEX_FILE, index);
    assert.equal(calls[3].env?.GIT_AUTHOR_DATE, "2026-11-18T00:00:00.000Z");
    assert.equal(calls[3].env?.GIT_COMMITTER_DATE, "2026-11-18T00:00:00.000Z");
  });

  test("a nested output path lands at that path in the tree and URL", () => {
    const { calls, run } = fakeGit();
    pushAssetBranch({ ...push, gifPath: "assets/critter.gif" }, run);
    assert.deepEqual(calls[1].args, ["add", "--force", "--", "assets/critter.gif"]);
    assert.equal(assetRawUrl("sam/sam", "critter-output", "assets/critter.gif"), "https://raw.githubusercontent.com/sam/sam/critter-output/assets/critter.gif");
  });

  test("the raw URL encodes odd path segments", () => {
    assert.equal(assetRawUrl("sam/sam", "b", "my pics/critter.gif"), "https://raw.githubusercontent.com/sam/sam/b/my%20pics/critter.gif");
  });
});
