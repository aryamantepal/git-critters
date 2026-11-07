// The GitHub Action: draw the chosen critter, add it to the README, and commit.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { languageColourway, LANGUAGES_COLOURWAY } from "../activity/colourway.ts";
import { traitsFor, yesterday } from "../activity/traits.ts";
import { critters, findCritter } from "../critters/index.ts";
import type { Colourway } from "../engine/critter.ts";
import { encodeGif } from "../engine/gif.ts";
import { DEFAULT_TRAITS } from "../engine/traits.ts";
import type { Traits } from "../engine/traits.ts";
import { readActivity } from "./activity.ts";
import type { Look } from "./activity.ts";
import { KEEP_ALIVE_MESSAGE, needsKeepAlive } from "./keepalive.ts";
import { critterBlock, withCritterBlock } from "./readme.ts";

function input(name: string): string {
  return (process.env[`INPUT_${name.toUpperCase()}`] ?? "").trim();
}

function fail(message: string): never {
  console.log(`::error::${message}`);
  process.exit(1);
}

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

function useBotIdentity(): void {
  git("config", "user.name", "github-actions[bot]");
  git("config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com");
}

/** Read what the critter is drawn from. A failure is a warning, never a failed run. */
async function lookUp(login: string, now: Date): Promise<Look | null> {
  try {
    const look = await readActivity({ login, token: input("token"), now, fetch });
    if (!look) console.log(`::warning::GitHub has no user called ${login}, so there's no activity to draw from.`);
    return look;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.log(`::warning::Couldn't read ${login}'s activity from GitHub: ${reason.replace(/\s+/g, " ")}`);
    return null;
  }
}

async function main(): Promise<void> {
  const critter = findCritter(input("critter"));
  if (!critter) {
    fail(`Unknown critter "${input("critter")}". Choose from: ${critters.map((c) => c.id).join(", ")}.`);
  }

  const activityInput = (input("activity") || "false").toLowerCase();
  if (activityInput !== "true" && activityInput !== "false") {
    fail(`activity must be true or false, not "${input("activity")}".`);
  }
  const activity = activityInput === "true";

  // A fixed colourway always wins. With activity on and none chosen, the colour comes from languages.
  const colour = input("colour");
  if (colour === LANGUAGES_COLOURWAY && !activity) {
    fail(`colour: ${LANGUAGES_COLOURWAY} draws from your languages, so it needs activity: true.`);
  }
  const fixed = colour !== "" && colour !== LANGUAGES_COLOURWAY;
  if (fixed && !critter.colourways.some((way) => way.id === colour)) {
    fail(
      `${critter.name} doesn't come in "${colour}". ` +
        `Choose from: ${critter.colourways.map((way) => way.id).join(", ")}` +
        `${activity ? `, or ${LANGUAGES_COLOURWAY}` : ""}.`,
    );
  }

  const gifPath = input("output") || "critter.gif";
  if (gifPath.startsWith("/") || gifPath.split("/").includes("..")) {
    fail(`output must be a path inside the repository, not "${gifPath}".`);
  }

  const now = new Date();
  let colourway: string | Colourway = fixed ? colour : critter.colourways[0].id;
  let traits: Traits = DEFAULT_TRAITS;
  let message = `critter: draw the ${colourway} ${critter.id}`;
  let added = `Added the ${colourway} ${critter.id}`;
  if (activity) {
    const login = input("login");
    if (!login) fail("login is empty, so there's no one to draw the critter for.");
    const look = await lookUp(login, now);
    if (!look && existsSync(gifPath)) {
      console.log("Leaving the critter as it was, and trying again at the next run.");
      return;
    }
    if (look) {
      traits = traitsFor(look.activity, now);
      if (!fixed) colourway = languageColourway(critter, look.languages);
      console.log(
        `Drawing from ${login}'s activity: stage ${traits.stage}, ${traits.marks} marks, ${traits.mood}` +
          `${fixed ? "" : `, coloured by ${look.languages.join(" and ") || "the default colours"}`}.`,
      );
    } else {
      console.log("Drawing the default critter for now.");
    }
    message = `critter: draw the ${critter.id} for ${yesterday(now)}`;
    added = `Added the ${critter.id}`;
  }

  mkdirSync(dirname(gifPath), { recursive: true });
  writeFileSync(gifPath, encodeGif(critter, colourway, traits));

  // Profile READMEs can be named in any case, so keep whichever one is already there.
  const readmeName = readdirSync(".").find((name) => /^readme(\.md)?$/i.test(name)) ?? "README.md";
  const readme = existsSync(readmeName) ? readFileSync(readmeName, "utf8") : "";
  writeFileSync(readmeName, withCritterBlock(readme, critterBlock(critter, gifPath)));

  // Forced, because someone's .gitignore shouldn't stop their critter from appearing.
  git("add", "--force", "--", gifPath, readmeName);
  if (git("diff", "--cached", "--name-only").trim() === "") {
    console.log("The critter is already up to date, so there's nothing to commit.");
    // Scheduled workflows stop after 60 days of silence, so an unchanged critter still needs a commit now and then.
    if (activity && needsKeepAlive(new Date(git("log", "-1", "--format=%cI").trim()), now)) {
      useBotIdentity();
      git("commit", "--quiet", "--allow-empty", "--message", KEEP_ALIVE_MESSAGE);
      git("push", "--quiet");
      console.log("The last commit is getting old, so this made an empty one to keep the nightly run active.");
    }
    return;
  }
  useBotIdentity();
  git("commit", "--quiet", "--message", message);
  git("push", "--quiet");
  console.log(`${added} to ${readmeName}.`);
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
