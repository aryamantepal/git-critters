import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { lookUpProfile } from "../src/site/github.ts";
import type { Profile } from "../src/site/github.ts";

/** A fetch that answers from a route table and records every call. */
function fakeFetch(routes: Record<string, { status?: number; body?: unknown; text?: string }>) {
  const calls: string[] = [];
  const impl = (async (url: string) => {
    calls.push(url);
    // GitHub's user and repo paths are case-insensitive, so match them that way.
    const normalized = url.toLowerCase();
    for (const [prefix, reply] of Object.entries(routes)) {
      if (normalized === `https://api.github.com${prefix}` || normalized.startsWith(`https://api.github.com${prefix}`)) {
        if (reply.text !== undefined) return new Response(reply.text, { status: reply.status ?? 200 });
        return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200 });
      }
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { impl, calls };
}

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

const USER_SAM = { login: "sam", type: "User" };
const REPOS = [{ fork: false, language: "TypeScript" }, { fork: false, language: "Rust" }, { fork: true, language: "Go" }];

function happyRoutes(installed = false) {
  return {
    "/users/sam/repos": { body: REPOS },
    "/users/sam": { body: USER_SAM },
    "/repos/sam/sam/readme": { text: "<article><p>hi</p></article>" },
    "/repos/sam/sam/contents/.github/workflows/critter.yml": installed ? { body: {} } : { status: 404 },
    "/repos/sam/sam": { body: { default_branch: "main" } },
  };
}

describe("site username lookups", () => {
  test("a missing username costs one request, not two", async () => {
    const { impl, calls } = fakeFetch({});
    const profile = await lookUpProfile("ghost", { fetchImpl: impl, storage: null });
    assert.equal(profile.kind, "missing");
    assert.deepEqual(calls, ["https://api.github.com/users/ghost"]);
  });

  test("an organization costs one request and never touches /repos", async () => {
    const { impl, calls } = fakeFetch({ "/users/acme": { body: { login: "acme", type: "Organization" } } });
    const profile = await lookUpProfile("acme", { fetchImpl: impl, storage: null });
    assert.deepEqual(profile, { kind: "organization", login: "acme" });
    assert.deepEqual(calls, ["https://api.github.com/users/acme"]);
  });

  test("a ready profile reads the user, then repos in parallel, then readme and workflow", async () => {
    const { impl, calls } = fakeFetch(happyRoutes(true));
    const profile = await lookUpProfile("sam", { fetchImpl: impl, storage: null });
    assert.equal(profile.kind, "ready");
    if (profile.kind === "ready") {
      assert.equal(profile.login, "sam");
      assert.equal(profile.branch, "main");
      assert.equal(profile.installed, true);
      assert.ok(profile.readmeHtml!.includes("hi"));
      assert.deepEqual(profile.languages, ["Rust", "TypeScript"]);
    }
    assert.deepEqual(calls.sort(), [
      "https://api.github.com/repos/sam/sam",
      "https://api.github.com/repos/sam/sam/contents/.github/workflows/critter.yml",
      "https://api.github.com/repos/sam/sam/readme",
      "https://api.github.com/users/sam",
      "https://api.github.com/users/sam/repos?per_page=100&type=owner&sort=pushed",
    ]);
  });

  test("someone without a profile repo costs three requests and still gets languages", async () => {
    const routes = happyRoutes();
    delete (routes as Record<string, unknown>)["/repos/sam/sam"];
    const { impl, calls } = fakeFetch(routes);
    const profile = await lookUpProfile("sam", { fetchImpl: impl, storage: null });
    assert.equal(profile.kind, "no-repo");
    if (profile.kind === "no-repo") assert.deepEqual(profile.languages, ["Rust", "TypeScript"]);
    assert.equal(calls.length, 3);
    assert.ok(!calls.some((url) => url.includes("/readme")));
  });

  test("a failed lookup is reported as unknown and never cached", async () => {
    const { impl, calls } = fakeFetch({ "/users/sam": { status: 500, body: {} } });
    const storage = fakeStorage();
    const profile = await lookUpProfile("sam", { fetchImpl: impl, storage });
    assert.equal(profile.kind, "unknown");
    assert.equal(storage.map.size, 0);
    await lookUpProfile("sam", { fetchImpl: impl, storage });
    assert.equal(calls.length, 2, "unknown results are looked up again");
  });
});

describe("the lookup cache", () => {
  test("a missing repo is not cached and the next lookup finds the newly created repo", async () => {
    const routes = happyRoutes();
    delete (routes as Record<string, unknown>)["/repos/sam/sam"];
    const { impl, calls } = fakeFetch(routes);
    const storage = fakeStorage();
    const options = { fetchImpl: impl, storage, now: () => 1_000_000 };

    assert.equal((await lookUpProfile("sam", options)).kind, "no-repo");
    assert.equal(storage.map.size, 0, "missing repos must not be cached");

    routes["/repos/sam/sam"] = { body: { default_branch: "main" } };
    const ready = await lookUpProfile("sam", options);
    assert.equal(ready.kind, "ready", "refresh finds the repo without waiting for the TTL");
    assert.equal(calls.length, 8);
    assert.deepEqual(await lookUpProfile("sam", options), ready);
    assert.equal(calls.length, 8, "positive results remain cached");
  });

  test("an unexpired no-repo entry from an older version is ignored", async () => {
    const { impl, calls } = fakeFetch(happyRoutes());
    const storage = fakeStorage();
    storage.setItem("git-critters:profile:sam", JSON.stringify({
      at: 1_000_000,
      profile: { kind: "no-repo", login: "sam", languages: [] },
    }));
    const options = { fetchImpl: impl, storage, now: () => 1_000_000 };

    const ready = await lookUpProfile("SAM", options);
    assert.equal(ready.kind, "ready");
    assert.equal(calls.length, 5, "legacy no-repo entries trigger a fresh lookup");
    assert.deepEqual(await lookUpProfile("sam", options), ready);
    assert.equal(calls.length, 5, "the legacy entry is replaced with the positive result");
  });

  test("a repeated lookup within the TTL makes no requests and is keyed case-insensitively", async () => {
    const { impl, calls } = fakeFetch(happyRoutes());
    const storage = fakeStorage();
    let now = 1_000_000;
    const options = { fetchImpl: impl, storage, now: () => now };
    const first = await lookUpProfile("Sam", options);
    assert.equal(first.kind, "ready");
    const afterFirst = calls.length;
    const second = await lookUpProfile("SAM", options);
    assert.deepEqual(second, first);
    assert.equal(calls.length, afterFirst, "served from the cache");
    now += 4 * 60 * 1000;
    await lookUpProfile("sam", options);
    assert.equal(calls.length, afterFirst, "still inside the TTL");
  });

  test("a cached profile expires after the TTL, and bypassCache skips the cache", async () => {
    const { impl, calls } = fakeFetch(happyRoutes());
    const storage = fakeStorage();
    let now = 1_000_000;
    const options = { fetchImpl: impl, storage, now: () => now };
    await lookUpProfile("sam", options);
    const afterFirst = calls.length;
    now += 6 * 60 * 1000;
    await lookUpProfile("sam", options);
    assert.ok(calls.length > afterFirst, "expired cache is refreshed");
    const afterSecond = calls.length;
    const profile: Profile = await lookUpProfile("sam", { ...options, bypassCache: true });
    assert.equal(profile.kind, "ready");
    assert.ok(calls.length > afterSecond, "bypassCache goes to GitHub");
  });
});
