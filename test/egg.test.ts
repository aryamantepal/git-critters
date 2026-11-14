import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readEggContributions } from "../src/action/activity.ts";
import {
  crackLevelFor,
  hasHatched,
  HATCH_AFTER,
  HATCHLING_POOL,
  hatchlingFor,
  LEGACY_SURPRISE_POOL,
  legacySurpriseFor,
} from "../src/activity/egg.ts";
import { egg } from "../src/critters/egg.ts";
import { critters } from "../src/critters/index.ts";

describe("hatching", () => {
  test("an egg hatches after 25 contributions, and cracks in quarters before that", () => {
    assert.equal(HATCH_AFTER, 25);
    const cases: [number, number][] = [
      [0, 0],
      [6, 0],
      [7, 1],
      [12, 1],
      [13, 2],
      [18, 2],
      [19, 3],
      [24, 3],
    ];
    for (const [contributions, level] of cases) {
      assert.equal(crackLevelFor(contributions), level, String(contributions));
      assert.equal(hasHatched(contributions), false, String(contributions));
    }
    assert.equal(hasHatched(HATCH_AFTER), true);
    assert.equal(hasHatched(HATCH_AFTER - 1), false);
  });

  test("the egg's crack levels all draw differently", () => {
    const frames = [0, 1, 2, 3].map((stage) => egg.draw(30, { stage: stage as 0, marks: 0, mood: "steady" }));
    for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) assert.notDeepEqual(frames[a], frames[b]);
  });
});

describe("the automatic hatchling", () => {
  test("is the same critter for the same login, whatever its case", () => {
    const locked: Record<string, string> = {
      octocat: "dragon",
      aryamantepal: "frog",
      github: "dragon",
      "ada-lovelace": "ghost",
      "Zoe-9": "axolotl",
      sam: "frog",
      a: "dragon",
    };
    for (const [login, critter] of Object.entries(locked)) {
      assert.equal(hatchlingFor(login), critter, login);
      assert.equal(hatchlingFor(login.toUpperCase()), critter, login);
    }
  });

  test("can be any current critter, and the pool is frozen", () => {
    assert.deepEqual([...HATCHLING_POOL], critters.map((critter) => critter.id));
    assert.ok(Object.isFrozen(HATCHLING_POOL));
    const reached = new Set(Array.from({ length: 1000 }, (_, n) => hatchlingFor(`user-${n}`)));
    assert.deepEqual([...reached].sort(), [...HATCHLING_POOL].sort());
  });

  test("only names critters the Action can draw", () => {
    for (const id of HATCHLING_POOL) assert.ok(critters.some((c) => c.id === id), id);
  });
});

describe("legacy critter: surprise", () => {
  test("keeps the original four-way username mapping", () => {
    assert.deepEqual([...LEGACY_SURPRISE_POOL], ["dragon", "axolotl", "jellyfish", "ghost"]);
    assert.ok(Object.isFrozen(LEGACY_SURPRISE_POOL));
    const locked: Record<string, string> = {
      octocat: "jellyfish",
      aryamantepal: "dragon",
      github: "jellyfish",
      "ada-lovelace": "axolotl",
      "Zoe-9": "ghost",
      sam: "dragon",
      a: "dragon",
    };
    for (const [login, critter] of Object.entries(locked)) assert.equal(legacySurpriseFor(login), critter, login);
  });
});

describe("the egg itself", () => {
  test("isn't a species anyone can pick", () => {
    assert.equal(egg.id, "egg");
    assert.ok(!critters.includes(egg));
    assert.ok(!critters.some((c) => c.id === egg.id));
  });

  test("keeps the README image the same size as every critter's", () => {
    for (const critter of critters) {
      assert.equal(egg.width, critter.width);
      assert.equal(egg.height, critter.height);
    }
  });

  test("its alt text says nothing about what's inside", () => {
    assert.match(egg.alt, /speckled egg/);
    for (const critter of critters) {
      assert.ok(!egg.alt.toLowerCase().includes(critter.id), critter.id);
      assert.ok(!egg.alt.toLowerCase().includes(critter.name.toLowerCase()), critter.name);
    }
  });
});

describe("when the workflow was added", () => {
  const NOW = new Date("2026-11-06T00:37:12Z");
  const ENV = { GITHUB_REPOSITORY: "sam/sam", GITHUB_WORKFLOW_REF: "sam/sam/.github/workflows/pet.yml@refs/heads/main" };

  const commit = (date: string) => [{ commit: { committer: { date } } }];

  /** A fetch that answers the commit list from a script and the contribution totals from a table. */
  function fakeFetch(commits: (url: string) => { body: unknown; link?: string; status?: number }, totals = 4) {
    const calls: { url: string; body: string }[] = [];
    const impl = (async (url: string, init?: RequestInit) => {
      const body = String(init?.body ?? "");
      calls.push({ url, body });
      if (url.endsWith("/graphql")) {
        const aliases = [...body.matchAll(/(y\d{4}): contributionsCollection/g)].map((m) => m[1]);
        const user = Object.fromEntries(aliases.map((alias) => [alias, { contributionCalendar: { totalContributions: totals } }]));
        return new Response(JSON.stringify({ data: { user } }));
      }
      const reply = commits(url);
      const headers = reply.link ? { link: reply.link } : undefined;
      return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200, headers });
    }) as typeof fetch;
    return { impl, calls };
  }

  const read = (impl: typeof fetch, env: Record<string, string> = ENV) =>
    readEggContributions({ login: "sam", token: "secret", now: NOW, fetch: impl }, env);

  const windowsOf = (calls: { body: string }[]) =>
    [...(calls.find((c) => c.body.includes("contributionsCollection"))?.body ?? "").matchAll(/(y\d{4}): contributionsCollection\(from: \\"([^\\]+)\\", to: \\"([^\\]+)\\"/g)].map(
      (m) => [m[1], m[2], m[3]],
    );

  test("follows the last page to the oldest commit of the workflow file named in GITHUB_WORKFLOW_REF", async () => {
    const { impl, calls } = fakeFetch((url) =>
      url.includes("page=7")
        ? { body: commit("2025-12-20T09:30:00Z") }
        : {
            body: commit("2026-10-01T00:00:00Z"),
            link: '<https://api.github.com/repositories/1/commits?path=x&per_page=1&page=2>; rel="next", <https://api.github.com/repositories/1/commits?path=x&per_page=1&page=7>; rel="last"',
          },
    );
    await read(impl);
    assert.equal(calls[0].url, "https://api.github.com/repos/sam/sam/commits?path=.github%2Fworkflows%2Fpet.yml&per_page=1");
    assert.ok(calls[1].url.endsWith("page=7"));
  });

  test("sums one window per calendar year, the first starting when the workflow was added", async () => {
    const { impl, calls } = fakeFetch((url) =>
      url.includes("page=7")
        ? { body: commit("2025-12-20T09:30:00Z") }
        : { body: commit("2026-10-01T00:00:00Z"), link: '<https://api.github.com/x?page=7>; rel="last"' },
    );
    assert.equal(await read(impl), 8);
    assert.deepEqual(windowsOf(calls), [
      ["y2025", "2025-12-20T09:30:00.000Z", "2025-12-31T23:59:59Z"],
      ["y2026", "2026-01-01T00:00:00Z", "2026-11-06T00:37:12.000Z"],
    ]);
  });

  test("a single commit has no link, and is the one", async () => {
    const { impl, calls } = fakeFetch(() => ({ body: commit("2026-11-02T10:00:00Z") }));
    assert.equal(await read(impl), 4);
    assert.deepEqual(windowsOf(calls), [["y2026", "2026-11-02T10:00:00.000Z", "2026-11-06T00:37:12.000Z"]]);
  });

  test("no commits means it was added just now", async () => {
    const { impl, calls } = fakeFetch(() => ({ body: [] }));
    await read(impl);
    assert.deepEqual(windowsOf(calls), [["y2026", NOW.toISOString(), NOW.toISOString()]]);
  });

  test("falls back to the usual workflow path when there's no GITHUB_WORKFLOW_REF", async () => {
    const { impl, calls } = fakeFetch(() => ({ body: [] }));
    await read(impl, { GITHUB_REPOSITORY: "sam/sam" });
    assert.match(calls[0].url, /path=\.github%2Fworkflows%2Fcritter\.yml&/);
  });

  test("rejects when GitHub can't be read, so the existing critter stays", async () => {
    await assert.rejects(read(fakeFetch(() => ({ body: {}, status: 403 })).impl), /403/);
    await assert.rejects(read(fakeFetch(() => ({ body: [] })).impl, {}), /GITHUB_REPOSITORY/);
  });
});
