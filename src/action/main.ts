// The GitHub Action: draw the chosen critter, add it to the README, and commit.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { languageColourway, LANGUAGES_COLOURWAY } from "../activity/colourway.ts";
import { crackLevelFor, hasHatched, hatchlingFor, HATCH_AFTER, legacySurpriseFor } from "../activity/egg.ts";
import { moodFor, traitsFor, yesterday } from "../activity/traits.ts";
import { egg, FRESH_EGG } from "../critters/egg.ts";
import { critters, findCritter } from "../critters/index.ts";
import type { Colourway, Critter } from "../engine/critter.ts";
import { encodeGif } from "../engine/gif.ts";
import { DEFAULT_TRAITS } from "../engine/traits.ts";
import type { Traits } from "../engine/traits.ts";
import { readActivity, readEggContributions } from "./activity.ts";
import type { Look } from "./activity.ts";
import { KEEP_ALIVE_MESSAGE, needsKeepAlive } from "./keepalive.ts";
import { critterBlock, hasOtherCreature, OTHER_CREATURE_LEFTOVERS, withCritterBlock } from "./readme.ts";

/** The old explicit value that leaves the choice to the egg. Kept for existing workflows. */
const SURPRISE = "surprise";

function input(name: string): string {
  return (process.env[`INPUT_${name.toUpperCase()}`] ?? "").trim();
}

function fail(message: string): never {
  console.log(`::error::${message}`);
  process.exit(1);
}

function flag(name: string): boolean {
  const value = (input(name) || "false").toLowerCase();
  if (value !== "true" && value !== "false") fail(`${name} must be true or false, not "${input(name)}".`);
  return value === "true";
}

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

function useBotIdentity(): void {
  git("config", "user.name", "github-actions[bot]");
  git("config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com");
}

interface Reading {
  look: Look;
  /** Contributions since the workflow was added. Only read for an egg. */
  sinceAdded: number;
}

/** Read what the critter is drawn from. A failure is a warning, never a failed run. */
async function lookUp(login: string, now: Date, forEgg: boolean): Promise<Reading | null> {
  try {
    const request = { login, token: input("token"), now, fetch };
    const look = await readActivity(request);
    if (!look) {
      console.log(`::warning::GitHub has no user called ${login}, so there's no activity to draw from.`);
      return null;
    }
    return { look, sinceAdded: forEgg ? await readEggContributions(request, process.env) : 0 };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.log(`::warning::Couldn't read ${login}'s activity from GitHub: ${reason.replace(/\s+/g, " ")}`);
    return null;
  }
}

interface Plan {
  critter: Critter;
  colourway: string | Colourway;
  traits: Traits;
  message: string;
  added: string;
}

async function main(): Promise<void> {
  const critterInput = input("critter");
  const automatic = critterInput === "";
  const legacySurprise = critterInput === SURPRISE;
  const usernameChosen = automatic || legacySurprise;
  const picked = usernameChosen ? undefined : findCritter(critterInput);
  if (!usernameChosen && !picked) {
    fail(`Unknown critter "${input("critter")}". Choose from: ${[...critters.map((c) => c.id), SURPRISE].join(", ")}.`);
  }

  const activity = flag("activity");
  const eggOn = flag("egg") || usernameChosen;
  if (eggOn && !activity) {
    fail(
      `${usernameChosen ? "An automatic hatchling" : "egg: true"} needs activity: true, ` +
        "since the egg hatches from your contributions.",
    );
  }

  // A fixed colourway always wins. With activity on and none chosen, the colour comes from languages.
  const colour = input("colour");
  if (colour === LANGUAGES_COLOURWAY && !activity) {
    fail(`colour: ${LANGUAGES_COLOURWAY} draws from your languages, so it needs activity: true.`);
  }
  const fixed = colour !== "" && colour !== LANGUAGES_COLOURWAY;
  if (fixed && usernameChosen) {
    fail(
      `An automatic hatchling can't use the fixed colour "${colour}", since each colour belongs to one critter. ` +
        `Use colour: ${LANGUAGES_COLOURWAY}, or leave colour out.`,
    );
  }
  if (fixed && picked && !picked.colourways.some((way) => way.id === colour)) {
    fail(
      `${picked.name} doesn't come in "${colour}". ` +
        `Choose from: ${picked.colourways.map((way) => way.id).join(", ")}` +
        `${activity ? `, or ${LANGUAGES_COLOURWAY}` : ""}.`,
    );
  }

  const gifPath = input("output") || "critter.gif";
  if (gifPath.startsWith("/") || gifPath.split("/").includes("..")) {
    fail(`output must be a path inside the repository, not "${gifPath}".`);
  }

  // Profile READMEs can be named in any case, so keep whichever one is already there.
  const readmeName = readdirSync(".").find((name) => /^readme(\.md)?$/i.test(name)) ?? "README.md";
  const readme = existsSync(readmeName) ? readFileSync(readmeName, "utf8") : "";

  const now = new Date();
  let plan: Plan;
  if (!activity) {
    const critter = picked!;
    const way = fixed ? colour : critter.colourways[0].id;
    plan = {
      critter,
      colourway: way,
      traits: DEFAULT_TRAITS,
      message: `critter: draw the ${way} ${critter.id}`,
      added: `Added the ${way} ${critter.id}`,
    };
  } else {
    const login = input("login");
    if (!login) fail("login is empty, so there's no one to draw the critter for.");
    const reading = await lookUp(login, now, eggOn);
    if (!reading && existsSync(gifPath)) {
      console.log("Leaving the critter as it was, and trying again at the next run.");
      return;
    }

    if (eggOn && (!reading || !hasHatched(reading.sinceAdded))) {
      // Nothing here may name the hatchling, so it isn't worked out until it has hatched.
      const message = `critter: draw the egg for ${yesterday(now)}`;
      if (reading) {
        console.log(`Drawing the egg: ${reading.sinceAdded} of ${HATCH_AFTER} contributions.`);
        plan = {
          critter: egg,
          colourway: languageColourway(egg, reading.look.languages),
          traits: { stage: crackLevelFor(reading.sinceAdded), marks: 0, mood: moodFor(reading.look.activity.days, now) },
          message,
          added: "Added the egg",
        };
      } else {
        console.log("Drawing an uncracked egg for now.");
        plan = { critter: egg, colourway: egg.colourways[0].id, traits: FRESH_EGG, message, added: "Added the egg" };
      }
    } else {
      const critter = picked ?? findCritter(legacySurprise ? legacySurpriseFor(login) : hatchlingFor(login))!;
      let colourway: string | Colourway = fixed ? colour : critter.colourways[0].id;
      let traits: Traits = DEFAULT_TRAITS;
      if (reading) {
        traits = traitsFor(reading.look.activity, now);
        if (!fixed) colourway = languageColourway(critter, reading.look.languages);
        console.log(
          `Drawing from ${login}'s activity: stage ${traits.stage}, ${traits.marks} marks, ${traits.mood}` +
            `${fixed ? "" : `, coloured by ${reading.look.languages.join(" and ") || "the default colours"}`}.`,
        );
      } else {
        console.log("Drawing the default critter for now.");
      }
      plan = {
        critter,
        colourway,
        traits,
        message: `critter: draw the ${critter.id} for ${yesterday(now)}`,
        added: `Added the ${critter.id}`,
      };
    }
  }

  mkdirSync(dirname(gifPath), { recursive: true });
  writeFileSync(gifPath, encodeGif(plan.critter, plan.colourway, plan.traits));
  const nextReadme = withCritterBlock(readme, critterBlock(gifPath));
  const readmeChanged = nextReadme !== readme;
  if (readmeChanged) writeFileSync(readmeName, nextReadme);
  if (hasOtherCreature(readme)) console.log(`::notice::${OTHER_CREATURE_LEFTOVERS}`);

  // Forced, because someone's .gitignore shouldn't stop their critter from appearing.
  git("add", "--force", "--", gifPath, ...(readmeChanged ? [readmeName] : []));
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
  git("commit", "--quiet", "--message", plan.message);
  git("push", "--quiet");
  console.log(`${plan.added} to ${readmeName}.`);
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
