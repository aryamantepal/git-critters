import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  LIVELY_FROM,
  longestStreak,
  marksFor,
  MARKS_FROM,
  moodFor,
  stageFor,
  STAGE_FROM,
  traitsFor,
  utcDay,
  yesterday,
} from "../src/activity/traits.ts";
import type { ContributionDay } from "../src/activity/traits.ts";
import { readActivity } from "../src/action/activity.ts";
import { KEEP_ALIVE_AFTER_DAYS, needsKeepAlive } from "../src/action/keepalive.ts";

const TODAY = new Date("2026-11-06T00:37:12Z");

/** A calendar for the year up to TODAY, with contributions on the given days (as days ago, 0 being today). */
function calendar(counts: Record<number, number>): ContributionDay[] {
  return Array.from({ length: 371 }, (_, ago) => ({
    date: utcDay(new Date(TODAY.getTime() - ago * 24 * 60 * 60 * 1000)),
    contributionCount: counts[ago] ?? 0,
  }));
}

const streakOf = (length: number, endingDaysAgo = 1) =>
  Object.fromEntries(Array.from({ length }, (_, n) => [endingDaysAgo + n, 1]));

describe("size", () => {
  test("steps up at 100, 1,000 and 5,000 lifetime contributions", () => {
    const cases: [number, number][] = [
      [0, 0],
      [99, 0],
      [100, 1],
      [999, 1],
      [1000, 2],
      [4999, 2],
      [5000, 3],
      [250_000, 3],
    ];
    for (const [contributions, stage] of cases) assert.equal(stageFor(contributions), stage, String(contributions));
  });
});

describe("marks", () => {
  test("come from the longest streak, at 7, 30 and 100 days", () => {
    const cases: [number, number][] = [
      [0, 0],
      [6, 0],
      [7, 1],
      [29, 1],
      [30, 2],
      [99, 2],
      [100, 3],
      [200, 3],
    ];
    for (const [days, marks] of cases) assert.equal(marksFor(calendar(streakOf(days)), TODAY), marks, `${days} days`);
  });

  test("count the longest run, not the current one, so a missed day takes nothing away", () => {
    const days = calendar({ ...streakOf(40, 20), 0: 3, 1: 2 });
    assert.equal(longestStreak(days, TODAY), 40);
    assert.equal(marksFor(days, TODAY), 2);
  });

  test("a gap breaks a run, and a run can include today", () => {
    assert.equal(longestStreak(calendar({ ...streakOf(5, 0), 6: 4, 7: 4, 8: 4 }), TODAY), 5);
    assert.equal(longestStreak(calendar({ 1: 1, 3: 1, 5: 1 }), TODAY), 1);
    assert.equal(longestStreak([], TODAY), 0);
  });

  test("only look back a year, and never forward", () => {
    const old = calendar({ ...streakOf(120, 365) });
    assert.ok(longestStreak(old, TODAY) < 8);
    const future: ContributionDay[] = [{ date: "2026-11-09", contributionCount: 5 }];
    assert.equal(longestStreak(future, TODAY), 0);
  });
});

describe("motion", () => {
  test("rests with nothing yesterday, is steady for 1 to 4, and lively from 5", () => {
    const cases: [number, string][] = [
      [0, "resting"],
      [1, "steady"],
      [LIVELY_FROM - 1, "steady"],
      [LIVELY_FROM, "lively"],
      [40, "lively"],
    ];
    for (const [count, mood] of cases) assert.equal(moodFor(calendar({ 1: count }), TODAY), mood, String(count));
  });

  test("is about the UTC day before today, whatever time the run starts", () => {
    assert.equal(yesterday(TODAY), "2026-11-05");
    assert.equal(yesterday(new Date("2026-11-06T23:59:59Z")), "2026-11-05");
    assert.equal(yesterday(new Date("2026-01-01T00:00:00Z")), "2025-12-31");
    // Today's own contributions say nothing about yesterday.
    assert.equal(moodFor(calendar({ 0: 30 }), TODAY), "resting");
    assert.equal(moodFor([], TODAY), "resting");
  });
});

test("the thresholds are the ones the issue agreed", () => {
  assert.deepEqual([...STAGE_FROM], [100, 1000, 5000]);
  assert.deepEqual([...MARKS_FROM], [7, 30, 100]);
  assert.equal(LIVELY_FROM, 5);
});

test("traitsFor puts them together", () => {
  const days = calendar({ ...streakOf(35), 1: 9 });
  assert.deepEqual(traitsFor({ lifetimeContributions: 1234, days }, TODAY), { stage: 2, marks: 2, mood: "lively" });
});

describe("keeping the nightly run alive", () => {
  const daysAgo = (days: number) => new Date(TODAY.getTime() - days * 24 * 60 * 60 * 1000);

  test("waits until the last commit is 50 days old", () => {
    assert.equal(KEEP_ALIVE_AFTER_DAYS, 50);
    assert.equal(needsKeepAlive(daysAgo(0), TODAY), false);
    assert.equal(needsKeepAlive(daysAgo(49), TODAY), false);
    assert.equal(needsKeepAlive(daysAgo(49.9), TODAY), false);
    assert.equal(needsKeepAlive(daysAgo(50), TODAY), true);
    assert.equal(needsKeepAlive(daysAgo(400), TODAY), true);
  });
});

describe("reading activity from GitHub", () => {
  const calendarReply = {
    data: {
      user: {
        contributionsCollection: {
          contributionYears: [2026, 2025],
          contributionCalendar: {
            weeks: [{ contributionDays: [{ date: "2026-11-05", contributionCount: 6 }] }, { contributionDays: [] }],
          },
        },
      },
    },
  };
  const totalsReply = {
    data: { user: { y2026: { contributionCalendar: { totalContributions: 700 } }, y2025: { contributionCalendar: { totalContributions: 450 } } } },
  };
  const repos = [
    { fork: false, language: "Go" },
    { fork: false, language: "Go" },
    { fork: true, language: "Rust" },
    { fork: false, language: null },
    { fork: false, language: "Zig" },
  ];

  /** A fetch that answers from a script and remembers what it was asked. */
  function fakeFetch(replies: (url: string, body: string) => { status?: number; body: unknown }) {
    const calls: { url: string; body: string; headers: Record<string, string> }[] = [];
    const impl = (async (url: string, init?: RequestInit) => {
      const body = String(init?.body ?? "");
      calls.push({ url, body, headers: (init?.headers ?? {}) as Record<string, string> });
      const reply = replies(url, body);
      return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
    }) as typeof fetch;
    return { impl, calls };
  }

  const ask = (impl: typeof fetch) => readActivity({ login: "sam", token: "secret", now: TODAY, fetch: impl });

  const healthy = (url: string, body: string) =>
    url.includes("/graphql")
      ? { body: body.includes("contributionYears") ? calendarReply : totalsReply }
      : { body: repos };

  test("sums every year for the lifetime total, and takes the top two languages", async () => {
    const { impl, calls } = fakeFetch(healthy);
    const look = await ask(impl);
    assert.equal(look?.activity.lifetimeContributions, 1150);
    assert.deepEqual(look?.activity.days, [{ date: "2026-11-05", contributionCount: 6 }]);
    assert.deepEqual(look?.languages, ["Go", "Zig"]);

    const totals = calls.find((call) => call.body.includes("y2025"));
    assert.ok(totals, "asked for each year on its own");
    const query = JSON.parse(totals.body).query as string;
    assert.match(query, /y2025: contributionsCollection\(from: "2025-01-01T00:00:00Z", to: "2025-12-31T23:59:59Z"\)/);
    assert.match(query, /y2026: contributionsCollection\(from: "2026-01-01T00:00:00Z", to: "2026-11-06T00:37:12.000Z"\)/);
    assert.ok(calls.some((call) => call.url === "https://api.github.com/users/sam/repos?per_page=100&type=owner&sort=pushed"));
    assert.ok(calls.every((call) => call.headers.Authorization === "Bearer secret"));
  });

  test("resolves to null for a user GitHub doesn't have, such as an organization", async () => {
    const { impl } = fakeFetch(() => ({ body: { data: { user: null }, errors: [{ type: "NOT_FOUND", message: "Could not resolve" }] } }));
    assert.equal(await ask(impl), null);
  });

  test("rejects when GitHub answers with an error", async () => {
    await assert.rejects(ask(fakeFetch(() => ({ status: 502, body: {} })).impl), /502/);
    await assert.rejects(
      ask(fakeFetch(() => ({ body: { errors: [{ type: "RATE_LIMITED", message: "slow down" }] } })).impl),
      /slow down/,
    );
    const repoFailure = fakeFetch((url, body) => (url.includes("/graphql") ? healthy(url, body) : { status: 403, body: {} }));
    await assert.rejects(ask(repoFailure.impl), /403/);
  });

  test("rejects when the network does", async () => {
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await assert.rejects(ask(down), /fetch failed/);
  });

  test("a new account with no years still works", async () => {
    const empty = {
      data: { user: { contributionsCollection: { contributionYears: [], contributionCalendar: { weeks: [] } } } },
    };
    const { impl } = fakeFetch((url) => (url.includes("/graphql") ? { body: empty } : { body: [] }));
    const look = await ask(impl);
    assert.equal(look?.activity.lifetimeContributions, 0);
    assert.deepEqual(look?.languages, []);
  });
});
