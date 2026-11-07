// Reads what a critter is drawn from: contributions and languages, straight from GitHub.
import { topLanguages } from "../activity/languages.ts";
import type { RepoLanguage } from "../activity/languages.ts";
import type { Activity, ContributionDay } from "../activity/traits.ts";
import { WORKFLOW_PATH } from "../site/links.ts";

const API = "https://api.github.com";

export interface ActivityRequest {
  login: string;
  token: string;
  now: Date;
  fetch: typeof fetch;
}

export interface Look {
  activity: Activity;
  /** The top two languages, by name. */
  languages: string[];
}

interface GraphQlResponse<Data> {
  data?: Data;
  errors?: { type?: string; message: string }[];
}

async function graphql<Data>(request: ActivityRequest, query: string): Promise<GraphQlResponse<Data>> {
  const response = await request.fetch(`${API}/graphql`, {
    method: "POST",
    headers: { Authorization: `Bearer ${request.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { login: request.login } }),
  });
  if (!response.ok) throw new Error(`GitHub's GraphQL API answered ${response.status}`);
  return (await response.json()) as GraphQlResponse<Data>;
}

/** A user missing from GraphQL is how an organization (or a typo) shows up. Anything else is a failure. */
function userOrNull<User>(result: GraphQlResponse<{ user: User | null }>): User | null {
  const unexpected = result.errors?.find((error) => error.type !== "NOT_FOUND");
  if (unexpected) throw new Error(unexpected.message);
  return result.data?.user ?? null;
}

interface CalendarUser {
  contributionsCollection: {
    contributionYears: number[];
    contributionCalendar: { weeks: { contributionDays: ContributionDay[] }[] };
  };
}

const CALENDAR_QUERY = `query($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionYears
      contributionCalendar { weeks { contributionDays { date contributionCount } } }
    }
  }
}`;

interface Window {
  year: number;
  from: string;
  to: string;
}

function yearWindow(year: number, now: Date, from = `${year}-01-01T00:00:00Z`): Window {
  return { year, from, to: year === now.getUTCFullYear() ? now.toISOString() : `${year}-12-31T23:59:59Z` };
}

/** One alias per window, which is a year or less, since a single collection can't span more. */
function totalsQuery(windows: readonly Window[]): string {
  const aliases = windows.map(
    ({ year, from, to }) => `    y${year}: contributionsCollection(from: "${from}", to: "${to}") {
      contributionCalendar { totalContributions }
    }`,
  );
  return `query($login: String!) {\n  user(login: $login) {\n${aliases.join("\n")}\n  }\n}`;
}

async function sumContributions(request: ActivityRequest, windows: readonly Window[]): Promise<number> {
  if (windows.length === 0) return 0;
  const result = await graphql<{ user: Record<string, { contributionCalendar: { totalContributions: number } }> | null }>(
    request,
    totalsQuery(windows),
  );
  const user = userOrNull(result);
  if (!user) throw new Error("GitHub stopped finding the user between two requests");
  return Object.values(user).reduce((sum, year) => sum + year.contributionCalendar.totalContributions, 0);
}

function lifetimeContributions(request: ActivityRequest, years: readonly number[]): Promise<number> {
  return sumContributions(request, years.map((year) => yearWindow(year, request.now)));
}

/** Contributions from `since` to now. The first window starts at `since`, not at 1 January. */
function contributionsSince(request: ActivityRequest, since: Date): Promise<number> {
  const start = since < request.now ? since : request.now;
  const windows: Window[] = [yearWindow(start.getUTCFullYear(), request.now, start.toISOString())];
  for (let year = start.getUTCFullYear() + 1; year <= request.now.getUTCFullYear(); year++) {
    windows.push(yearWindow(year, request.now));
  }
  return sumContributions(request, windows);
}

async function languagesOf(request: ActivityRequest): Promise<string[]> {
  const response = await request.fetch(
    `${API}/users/${encodeURIComponent(request.login)}/repos?per_page=100&type=owner&sort=pushed`,
    { headers: { Authorization: `Bearer ${request.token}`, Accept: "application/vnd.github+json" } },
  );
  if (!response.ok) throw new Error(`GitHub's repository list answered ${response.status}`);
  return topLanguages((await response.json()) as RepoLanguage[]);
}

/**
 * Read someone's contributions and languages. Resolves to null when GitHub has no
 * such user, as with an organization. Rejects when GitHub can't be read.
 */
export async function readActivity(request: ActivityRequest): Promise<Look | null> {
  const calendar = userOrNull(await graphql<{ user: CalendarUser | null }>(request, CALENDAR_QUERY));
  if (!calendar) return null;
  const { contributionYears, contributionCalendar } = calendar.contributionsCollection;
  const [lifetime, languages] = await Promise.all([
    lifetimeContributions(request, contributionYears),
    languagesOf(request),
  ]);
  return {
    activity: {
      lifetimeContributions: lifetime,
      days: contributionCalendar.weeks.flatMap((week) => week.contributionDays),
    },
    languages,
  };
}

/** The environment variables a workflow run has, as far as the egg needs them. */
export type RunEnv = Readonly<Record<string, string | undefined>>;

interface Commit {
  commit: { committer: { date: string } };
}

async function listCommits(request: ActivityRequest, url: string): Promise<{ commits: Commit[]; link: string }> {
  const response = await request.fetch(url, {
    headers: { Authorization: `Bearer ${request.token}`, Accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw new Error(`GitHub's commit list answered ${response.status}`);
  return { commits: (await response.json()) as Commit[], link: response.headers.get("link") ?? "" };
}

/** When the workflow file was first committed. No commits at all means it was added just now. */
async function workflowAdded(request: ActivityRequest, env: RunEnv): Promise<Date> {
  const repo = env.GITHUB_REPOSITORY;
  if (!repo) throw new Error("GITHUB_REPOSITORY isn't set");
  // GITHUB_WORKFLOW_REF looks like owner/repo/.github/workflows/critter.yml@refs/heads/main
  const ref = env.GITHUB_WORKFLOW_REF ?? "";
  const path = ref.startsWith(`${repo}/`) && ref.includes("@") ? ref.slice(repo.length + 1, ref.indexOf("@")) : WORKFLOW_PATH;
  const newest = await listCommits(request, `${API}/repos/${repo}/commits?path=${encodeURIComponent(path)}&per_page=1`);
  // One commit a page, newest first, so the last page holds the oldest. A single commit has no link.
  const last = /<([^>]+)>;\s*rel="last"/.exec(newest.link)?.[1];
  const oldest = last ? (await listCommits(request, last)).commits[0] : newest.commits[0];
  return oldest ? new Date(oldest.commit.committer.date) : request.now;
}

/** Contributions since the workflow was added, which is what an egg hatches from. */
export async function readEggContributions(request: ActivityRequest, env: RunEnv): Promise<number> {
  return contributionsSince(request, await workflowAdded(request, env));
}
