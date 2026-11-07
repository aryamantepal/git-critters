/** GitHub turns off scheduled workflows in a public repo after 60 days without activity. */
export const KEEP_ALIVE_AFTER_DAYS = 50;

export const KEEP_ALIVE_MESSAGE = "critter: keep the nightly run active";

/** Whether the latest commit is old enough that the schedule is at risk of being turned off. */
export function needsKeepAlive(latestCommit: Date, now: Date): boolean {
  return now.getTime() - latestCommit.getTime() >= KEEP_ALIVE_AFTER_DAYS * 24 * 60 * 60 * 1000;
}
