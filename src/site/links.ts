// The whole "add to my profile" system: links to GitHub's own pages, already filled in.
export const WORKFLOW_PATH = ".github/workflows/critter.yml";
const ACTION = "aryamantepal/git-critters@v1";
export const SITE_URL = "https://critters.aryamantepal.com";

const USERNAME = /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i;

export function isValidUsername(name: string): boolean {
  return USERNAME.test(name);
}

/** The one small file someone commits to get a critter. */
export function workflowFile(critter: string, colour: string): string {
  return `# Draws a pixel-art critter from your GitHub activity and adds it to the top of this README.
# To swap it, change the last two lines and commit: ${SITE_URL}
name: Critter

on:
  push:
    paths: [${WORKFLOW_PATH}]
  workflow_dispatch:
  schedule:
    - cron: "37 0 * * *" # just after midnight UTC, when yesterday's activity is complete

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
          critter: ${critter}
          colour: ${colour}
`;
}

/** GitHub's new-file page with the workflow already filled in, ready to commit. */
export function addLink(login: string, branch: string, critter: string, colour: string): string {
  const query = new URLSearchParams({
    filename: WORKFLOW_PATH,
    value: workflowFile(critter, colour),
    message: `Add a ${critter} to my profile`,
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
