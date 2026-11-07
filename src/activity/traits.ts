// How someone's activity decides what their critter looks like. Everything here is pure:
// the date comes in as `today`, so the same data always gives the same critter.
import type { Mood, Traits } from "../engine/traits.ts";

/** Lifetime contributions needed to reach stage 1, 2 and 3. Below the first is stage 0. */
export const STAGE_FROM = [100, 1000, 5000] as const;
/** Days in the longest streak needed for one, two and three marks. */
export const MARKS_FROM = [7, 30, 100] as const;
/** Contributions the day before that make a critter lively. Zero is resting. */
export const LIVELY_FROM = 5;

/** One square of GitHub's contribution calendar. The date is a UTC day, such as 2026-11-05. */
export interface ContributionDay {
  date: string;
  contributionCount: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The UTC day a date falls on, as GitHub writes it. */
export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dayNumber(day: string): number {
  return Date.parse(`${day}T00:00:00Z`) / DAY_MS;
}

function countAbove(thresholds: readonly number[], value: number): number {
  return thresholds.filter((from) => value >= from).length;
}

export function stageFor(lifetimeContributions: number): Traits["stage"] {
  return countAbove(STAGE_FROM, lifetimeContributions) as Traits["stage"];
}

/** The longest run of days in a row with contributions, over the year up to and including today. */
export function longestStreak(days: readonly ContributionDay[], today: Date): number {
  const last = dayNumber(utcDay(today));
  const active = days
    .filter((day) => day.contributionCount > 0)
    .map((day) => dayNumber(day.date))
    .filter((number) => number <= last && number > last - 365)
    .sort((a, b) => a - b);
  let longest = 0;
  let run = 0;
  active.forEach((number, i) => {
    run = i > 0 && number === active[i - 1] + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  });
  return longest;
}

export function marksFor(days: readonly ContributionDay[], today: Date): Traits["marks"] {
  return countAbove(MARKS_FROM, longestStreak(days, today)) as Traits["marks"];
}

/** The UTC day before `today`, which is the one that has just finished. */
export function yesterday(today: Date): string {
  return utcDay(new Date(today.getTime() - DAY_MS));
}

export function moodFor(days: readonly ContributionDay[], today: Date): Mood {
  const count = days.find((day) => day.date === yesterday(today))?.contributionCount ?? 0;
  return count === 0 ? "resting" : count < LIVELY_FROM ? "steady" : "lively";
}

export interface Activity {
  lifetimeContributions: number;
  days: readonly ContributionDay[];
}

export function traitsFor(activity: Activity, today: Date): Traits {
  return {
    stage: stageFor(activity.lifetimeContributions),
    marks: marksFor(activity.days, today),
    mood: moodFor(activity.days, today),
  };
}
