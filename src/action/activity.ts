// Reads what a critter is drawn from: contributions and languages, straight from GitHub.
import { topLanguages } from "../activity/languages.ts";
import type { RepoLanguage } from "../activity/languages.ts";
import type { Activity, ContributionDay } from "../activity/traits.ts";

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

/** One alias per year, since a single collection can't span more than one. */
function totalsQuery(years: readonly number[], now: Date): string {
  const aliases = years.map((year) => {
    const end = year === now.getUTCFullYear() ? now.toISOString() : `${year}-12-31T23:59:59Z`;
    return `    y${year}: contributionsCollection(from: "${year}-01-01T00:00:00Z", to: "${end}") {
      contributionCalendar { totalContributions }
    }`;
  });
  return `query($login: String!) {\n  user(login: $login) {\n${aliases.join("\n")}\n  }\n}`;
}

async function lifetimeContributions(request: ActivityRequest, years: readonly number[]): Promise<number> {
  if (years.length === 0) return 0;
  const result = await graphql<{ user: Record<string, { contributionCalendar: { totalContributions: number } }> | null }>(
    request,
    totalsQuery(years, request.now),
  );
  const user = userOrNull(result);
  if (!user) throw new Error("GitHub stopped finding the user between two requests");
  return Object.values(user).reduce((sum, year) => sum + year.contributionCalendar.totalContributions, 0);
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
