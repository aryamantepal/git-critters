// The whole "add to my profile" system: links to GitHub's own pages, already filled in.
import { hashLogin } from "../activity/egg.ts";

export const WORKFLOW_PATH = ".github/workflows/critter.yml";
const ACTION = "aryamantepal/git-critters@v1";
export const SITE_URL = "https://critters.aryamantepal.com";

/** The schedule the README's static example uses, when there's no login to spread it for. */
const DEFAULT_CRON = "37 0 * * *";

/**
 * The nightly run for a login, spread over 00:15–02:55 UTC and off the top and half
 * hour, when Actions queues are busiest. The same login always lands on the same minute.
 */
export function cronFor(login: string): string {
  const firstMinute = 15;
  const span = 161; // 00:15 through 02:55
  let minute = firstMinute + (hashLogin(login) % span);
  if (minute % 60 === 0 || minute % 60 === 30) minute += 1;
  return `${minute % 60} ${Math.floor(minute / 60)} * * *`;
}

const USERNAME = /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i;

export function isValidUsername(name: string): boolean {
  return USERNAME.test(name);
}

/** The one small file someone commits to get their username-derived hatchling. */
export function workflowFile(login?: string): string {
  const cron = login === undefined ? DEFAULT_CRON : cronFor(login);
  return `# Draws a pixel-art critter from your GitHub activity and adds it to this README.
# Your username determines which critter is inside the egg: ${SITE_URL}
name: Critter

on:
  push:
    paths: [${WORKFLOW_PATH}]
  workflow_dispatch:
  schedule:
    - cron: "${cron}" # after midnight UTC, when yesterday's activity is complete

permissions:
  contents: write

concurrency: critter

jobs:
  critter:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: ${ACTION}
        with:
          activity: true
`;
}

/** GitHub's new-file page with the workflow already filled in, ready to commit. */
export function addLink(login: string, branch: string): string {
  const query = new URLSearchParams({
    filename: WORKFLOW_PATH,
    value: workflowFile(login),
    message: "Add a git-critter to my profile",
  });
  return `https://github.com/${login}/${login}/new/${encodeURIComponent(branch)}?${query}`;
}

/** GitHub's new-repository page, filled in for a profile repo. */
export function createRepoLink(login: string): string {
  const query = new URLSearchParams({
    name: login,
    description: "My GitHub profile",
    visibility: "public",
  });
  return `https://github.com/new?${query}`;
}

/** GitHub's editor, open on a workflow that's already there. */
export function editLink(login: string, branch: string): string {
  return `https://github.com/${login}/${login}/edit/${encodeURIComponent(branch)}/${WORKFLOW_PATH}`;
}
