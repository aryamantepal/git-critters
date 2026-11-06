// The GitHub Action: draw the chosen critter, add it to the README, and commit.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { critters, findCritter } from "../critters/index.ts";
import { encodeGif } from "../engine/gif.ts";
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

const critter = findCritter(input("critter"));
if (!critter) {
  fail(`Unknown critter "${input("critter")}". Choose from: ${critters.map((c) => c.id).join(", ")}.`);
}

const colourway = input("colour") || critter.colourways[0].id;
if (!critter.colourways.some((way) => way.id === colourway)) {
  fail(
    `${critter.name} doesn't come in "${colourway}". ` +
      `Choose from: ${critter.colourways.map((way) => way.id).join(", ")}.`,
  );
}

const gifPath = input("output") || "critter.gif";
if (gifPath.startsWith("/") || gifPath.split("/").includes("..")) {
  fail(`output must be a path inside the repository, not "${gifPath}".`);
}

mkdirSync(dirname(gifPath), { recursive: true });
writeFileSync(gifPath, encodeGif(critter, colourway));

// Profile READMEs can be named in any case, so keep whichever one is already there.
const readmeName = readdirSync(".").find((name) => /^readme(\.md)?$/i.test(name)) ?? "README.md";
const readme = existsSync(readmeName) ? readFileSync(readmeName, "utf8") : "";
writeFileSync(readmeName, withCritterBlock(readme, critterBlock(critter, gifPath)));

// Forced, because someone's .gitignore shouldn't stop their critter from appearing.
git("add", "--force", "--", gifPath, readmeName);
if (git("diff", "--cached", "--name-only").trim() === "") {
  console.log("The critter is already up to date, so there's nothing to commit.");
  process.exit(0);
}
git("config", "user.name", "github-actions[bot]");
git("config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com");
git("commit", "--quiet", "--message", `critter: draw the ${colourway} ${critter.id}`);
git("push", "--quiet");
console.log(`Added the ${colourway} ${critter.id} to ${readmeName}.`);
