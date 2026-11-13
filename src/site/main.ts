import { languageColourway, LANGUAGES_COLOURWAY } from "../activity/colourway.ts";
import { HATCH_AFTER } from "../activity/egg.ts";
import { egg, FRESH_EGG } from "../critters/egg.ts";
import { critters } from "../critters/index.ts";
import { paletteOf, SCALE } from "../engine/critter.ts";
import type { Colourway, Critter } from "../engine/critter.ts";
import { encodeGif } from "../engine/gif.ts";
import { DEFAULT_TRAITS } from "../engine/traits.ts";
import type { Traits } from "../engine/traits.ts";
import { CRITTER_SLOT, lookUpProfile, prepareReadme } from "./github.ts";
import type { Profile } from "./github.ts";
import { hasOtherCreature, OTHER_CREATURE_LEFTOVERS } from "../action/readme.ts";
import { addLink, createRepoLink, editLink, isValidUsername } from "./links.ts";

function element<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const stage = element<HTMLCanvasElement>("stage");
const critterList = element("critters");
const critterSearch = element<HTMLInputElement>("critter-search");
const noCritters = element("no-critters");
const colourList = element("colours");
const colourNote = element("colour-note");
const traitList = element("traits");
const traitFieldset = element("try-the-rest");
const eggToggle = element<HTMLInputElement>("egg");
const eggNote = element("egg-note");
const blurb = element("blurb");
const usernameInput = element<HTMLInputElement>("username");
const addButton = element<HTMLAnchorElement>("add");
const statusLine = element("status");
const swapHelp = element("swap-help");
const swapLines = element("swap-lines");
const copySwap = element<HTMLButtonElement>("copy-swap");
const downloadButton = element<HTMLButtonElement>("download");
const preview = element("preview");
const pauseButton = element<HTMLButtonElement>("pause");
const profileName = element("profile-name");
const readmeContent = element("readme-content");
const critterParagraph = stage.closest("p") as HTMLElement;
const sampleReadme = element<HTMLTemplateElement>("sample-readme");

const state = {
  critter: critters[0],
  /** "Surprise me" is picked, so only the egg is shown, and nothing says what's inside. */
  surprise: false,
  /** Start from an egg. */
  egg: true,
  /** When set, the preview shows the egg at this crack level instead of the critter. */
  eggView: null as 0 | 2 | null,
  /** Colours from the visitor's languages, which is the default, rather than a fixed colourway. */
  useLanguages: true,
  languages: [] as string[],
  traits: { ...DEFAULT_TRAITS } as Traits,
  profile: null as Profile | null,
};
const chosenWays = new Map<string, Colourway>(critters.map((c) => [c.id, c.colourways[0]]));

/** Fixed colours belong to one species, so a surprise always uses languages, and so does the egg. */
function usingLanguages(critter: Critter = state.critter): boolean {
  return state.surprise || critter === egg || state.useLanguages;
}

/** What the preview is showing: the critter, or the egg when that's what's being looked at. */
function shown(): { critter: Critter; traits: Traits } {
  if (state.surprise) return { critter: egg, traits: FRESH_EGG };
  if (state.eggView !== null) return { critter: egg, traits: { stage: state.eggView, marks: 0, mood: state.traits.mood } };
  return { critter: state.critter, traits: state.traits };
}

/** The colours in use: the visitor's languages if they have any, else the critter's first colourway. */
function wayFor(critter: Critter): Colourway {
  if (!usingLanguages(critter)) return chosenWays.get(critter.id)!;
  return state.languages.length ? languageColourway(critter, state.languages) : critter.colourways[0];
}

/** Palette indexes to canvas pixels, as 32-bit values. */
function colourLookup(critter: Critter, way: Colourway): Uint32Array {
  const palette = paletteOf(critter, way);
  const lookup = new Uint32Array(palette.length / 3);
  for (let i = 1; i < lookup.length; i++) {
    lookup[i] = (0xff << 24) | (palette[i * 3 + 2] << 16) | (palette[i * 3 + 1] << 8) | palette[i * 3];
  }
  return lookup;
}

function paint(context: CanvasRenderingContext2D, image: ImageData, pixels: Uint8Array, lookup: Uint32Array): void {
  const out = new Uint32Array(image.data.buffer);
  for (let i = 0; i < pixels.length; i++) out[i] = lookup[pixels[i]];
  context.putImageData(image, 0, 0);
}

// The preview plays frames live on a canvas rather than a GIF, so changing critter
// or colour is instant. The GIF only gets encoded when someone downloads one.
const player = {
  context: stage.getContext("2d")!,
  image: null as ImageData | null,
  lookup: new Uint32Array(1) as Uint32Array,
  index: 0,
  last: 0,
  playing: !matchMedia("(prefers-reduced-motion: reduce)").matches,

  load(restart: boolean): void {
    const { critter } = shown();
    const way = wayFor(critter);
    if (stage.width !== critter.width || stage.height !== critter.height || !this.image) {
      stage.width = critter.width;
      stage.height = critter.height;
      this.image = this.context.createImageData(critter.width, critter.height);
    }
    stage.style.width = `${critter.width * SCALE}px`;
    stage.setAttribute("aria-label", critter.alt);
    this.lookup = colourLookup(critter, way);
    if (restart) this.index = critter.poster;
    this.draw();
  },

  draw(): void {
    const { critter, traits } = shown();
    paint(this.context, this.image!, critter.frame(this.index, traits), this.lookup);
  },

  tick(now: number): void {
    const { delayMs, frames } = shown().critter;
    if (this.playing) {
      // A tab that was in the background shouldn't try to catch up.
      if (now - this.last > 1000) this.last = now;
      if (now - this.last >= delayMs) {
        while (now - this.last >= delayMs) {
          this.index = (this.index + 1) % frames;
          this.last += delayMs;
        }
        this.draw();
      }
    }
    requestAnimationFrame((time) => this.tick(time));
  },
};

/** Draw a critter's poster frame, cropped close and scaled up by a whole number. */
function drawThumbnail(canvas: HTMLCanvasElement, critter: Critter, way: Colourway, traits: Traits): void {
  const { width, height } = critter;
  const pixels = critter.frame(critter.poster, traits);
  let left = width;
  let right = 0;
  let top = height;
  let bottom = 0;
  for (let y = 0, i = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i++) {
      if (!pixels[i]) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  const full = document.createElement("canvas");
  full.width = width;
  full.height = height;
  const fullContext = full.getContext("2d")!;
  paint(fullContext, fullContext.createImageData(width, height), pixels, colourLookup(critter, way));

  const context = canvas.getContext("2d")!;
  const boxWidth = right - left + 1;
  const boxHeight = bottom - top + 1;
  const scale = Math.max(1, Math.floor(Math.min(canvas.width / boxWidth, canvas.height / boxHeight)));
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = false;
  context.drawImage(
    full,
    left,
    top,
    boxWidth,
    boxHeight,
    Math.floor((canvas.width - boxWidth * scale) / 2),
    Math.floor((canvas.height - boxHeight * scale) / 2),
    boxWidth * scale,
    boxHeight * scale,
  );
}

const thumbnails = new Map<string, HTMLCanvasElement>();

const SURPRISE_BLURB = "An egg that hatches into one of the critters. You find out which when it does.";

function drawThumbnails(): void {
  for (const critter of critters) drawThumbnail(thumbnails.get(critter.id)!, critter, wayFor(critter), state.traits);
  drawThumbnail(thumbnails.get(egg.id)!, egg, wayFor(egg), FRESH_EGG);
}

interface CritterTile {
  critter: Critter;
  isSurprise: boolean;
  label: HTMLLabelElement;
  radio: HTMLInputElement;
}

const critterTiles: CritterTile[] = [];

/** Search is intentionally case-insensitive so names match however visitors type them. */
function normalizeCritterSearch(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function filterCritters(): void {
  const query = normalizeCritterSearch(critterSearch.value);
  let matches = 0;
  for (const tile of critterTiles) {
    const text = normalizeCritterSearch(
      tile.isSurprise ? "surprise me egg" : `${tile.critter.name} ${tile.critter.id}`,
    );
    const visible = !query || text.includes(query);
    tile.label.hidden = !visible;
    if (visible) matches++;
  }
  noCritters.hidden = matches > 0;
}

function buildCritterList(): void {
  critterTiles.length = 0;
  critterList.replaceChildren();
  // The egg is the fifth tile, for "Surprise me".
  for (const critter of [...critters, egg]) {
    const isSurprise = critter === egg;
    const label = document.createElement("label");
    label.className = isSurprise ? "critter surprise" : "critter";
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "critter";
    radio.value = isSurprise ? "surprise" : critter.id;
    radio.checked = isSurprise ? state.surprise : !state.surprise && critter === state.critter;
    radio.addEventListener("change", () => (isSurprise ? chooseSurprise() : choose(critter)));
    const canvas = document.createElement("canvas");
    canvas.width = 168;
    canvas.height = 128;
    canvas.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.textContent = isSurprise ? "Surprise me" : critter.name;
    label.append(radio, canvas, name);
    critterList.append(label);
    thumbnails.set(critter.id, canvas);
    critterTiles.push({ critter, isSurprise, label, radio });
  }
  filterCritters();
  drawThumbnails();
}

function buildColourList(): void {
  colourList.replaceChildren();
  const { critter } = state;
  const chosen = chosenWays.get(critter.id)!;
  const options: [string, Colourway, () => void][] = [
    ["My languages", wayFor(state.surprise ? egg : critter), () => chooseColour(null)],
    ...(state.surprise
      ? []
      : critter.colourways.map((way): [string, Colourway, () => void] => [way.name, way, () => chooseColour(way)])),
  ];
  options.forEach(([name, way, pick], n) => {
    const label = document.createElement("label");
    label.className = "colour";
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "colour";
    radio.value = n === 0 ? LANGUAGES_COLOURWAY : way.id;
    radio.checked = n === 0 ? usingLanguages() : !usingLanguages() && way.id === chosen.id;
    radio.addEventListener("change", pick);
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.setProperty("--swatch", swatchOf(way));
    const text = document.createElement("span");
    text.textContent = name;
    label.append(radio, swatch, text);
    colourList.append(label);
  });
}

function renderColourNote(): void {
  const whose = state.surprise ? "the egg's" : `${state.critter.name}'s`;
  if (!usingLanguages()) {
    colourNote.textContent = "";
  } else if (state.languages.length) {
    colourNote.textContent = `Coloured from your most-used languages: ${state.languages.join(" and ")}.`;
  } else if (state.profile) {
    colourNote.textContent = `No languages to colour from, so this shows ${whose} first colours.`;
  } else {
    colourNote.textContent = `Enter your username to colour it from your languages. Until then this shows ${whose} first colours.`;
  }
}

const TRAIT_ROWS = [
  { key: "stage", label: "Size", options: ["Hatchling", "Young", "Grown", "Elder"] },
  { key: "marks", label: "Marks", options: ["None", "7 days", "30 days", "100 days"] },
  { key: "mood", label: "Yesterday", options: ["Resting", "Steady", "Lively"] },
] as const;

/** With the egg on, Size starts with the egg, so people can see it. The numbers are crack levels. */
const EGG_VIEWS = [
  { text: "Egg", level: 0 },
  { text: "Cracking", level: 2 },
] as const;

interface TraitOption {
  text: string;
  checked: boolean;
  pick: () => void;
}

function buildTraitList(): void {
  traitList.replaceChildren();
  for (const row of TRAIT_ROWS) {
    const group = document.createElement("div");
    group.className = "trait-row";
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-label", row.label);
    const heading = document.createElement("span");
    heading.className = "trait-name";
    heading.setAttribute("aria-hidden", "true");
    heading.textContent = row.label;
    const options = document.createElement("div");
    options.className = "colours";
    const choices: TraitOption[] = row.options.map((text, n) => {
      const value = row.key === "mood" ? text.toLowerCase() : n;
      return {
        text,
        checked: state.traits[row.key] === value && (row.key !== "stage" || state.eggView === null),
        pick() {
          Object.assign(state.traits, { [row.key]: value });
          if (row.key === "stage") state.eggView = null;
        },
      };
    });
    if (row.key === "stage" && state.egg) {
      choices.unshift(
        ...EGG_VIEWS.map(({ text, level }) => ({
          text,
          checked: state.eggView === level,
          pick() {
            state.eggView = level;
          },
        })),
      );
    }
    for (const choice of choices) {
      const label = document.createElement("label");
      label.className = "colour plain";
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = `trait-${row.key}`;
      radio.checked = choice.checked;
      radio.addEventListener("change", () => {
        choice.pick();
        player.load(false);
        drawThumbnails();
      });
      const span = document.createElement("span");
      span.textContent = choice.text;
      label.append(radio, span);
      options.append(label);
    }
    group.append(heading, options);
    traitList.append(group);
  }
}

/** The colour that says the most about a colourway. */
function swatchOf(way: Colourway): string {
  const colours = way.colours as Record<string, string>;
  return colours.body ?? colours.shell ?? colours.bell ?? Object.values(colours)[2];
}

function applyAccent(way: Colourway): void {
  const hex = swatchOf(way);
  const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
  // Keep the button's label readable on whatever colour it takes on.
  const light = 0.299 * r + 0.587 * g + 0.114 * b > 150;
  document.documentElement.style.setProperty("--accent", hex);
  document.documentElement.style.setProperty("--on-accent", light ? "#1a1208" : "#ffffff");
}

function renderEgg(): void {
  eggToggle.checked = state.surprise || state.egg;
  eggToggle.disabled = state.surprise;
  eggNote.textContent =
    `It hatches into your critter after ${HATCH_AFTER} contributions since you add it, and cracks as you get closer.` +
    (state.surprise ? " Surprise me always starts from an egg." : "");
}

/** Show everything that depends on which critter is picked, or on whether the egg is on. */
function renderPick(restart: boolean): void {
  const { critter } = shown();
  blurb.textContent = state.surprise ? SURPRISE_BLURB : state.critter.blurb;
  traitFieldset.hidden = state.surprise;
  buildColourList();
  renderColourNote();
  renderEgg();
  buildTraitList();
  applyAccent(wayFor(critter));
  player.load(restart);
  renderAction();
}

function choose(critter: Critter): void {
  state.critter = critter;
  state.surprise = false;
  state.eggView = null;
  renderPick(true);
}

function chooseSurprise(): void {
  state.surprise = true;
  state.eggView = null;
  renderPick(true);
}

/** Pick a fixed colourway, or null for the visitor's languages. */
function chooseColour(fixed: Colourway | null): void {
  state.useLanguages = fixed === null;
  if (fixed) chosenWays.set(state.critter.id, fixed);
  applyAccent(wayFor(shown().critter));
  player.load(false);
  drawThumbnails();
  renderColourNote();
  renderAction();
}

/** The colour that goes in the workflow: "languages", or a fixed colourway's id. */
function colourId(): string {
  return usingLanguages() ? LANGUAGES_COLOURWAY : chosenWays.get(state.critter.id)!.id;
}

/** The value that goes in the workflow's critter line. A surprise never says what it is. */
function critterId(): string {
  return state.surprise ? "surprise" : state.critter.id;
}

function eggOn(): boolean {
  return state.surprise || state.egg;
}

function setAdd(label: string, href: string | null): void {
  addButton.textContent = label;
  if (href) addButton.href = href;
  else addButton.removeAttribute("href");
  addButton.classList.toggle("waiting", !href);
}

/** Update the button and the status line to match the critter and whoever's looking. */
function renderAction(): void {
  const { profile } = state;
  const colour = colourId();
  const critter = critterId();
  swapHelp.hidden = true;
  if (!profile) {
    setAdd("Add to my profile", null);
    statusLine.textContent = usernameInput.value.trim()
      ? "That doesn't look like a GitHub username."
      : "Enter your username to preview this on your own profile.";
    return;
  }
  switch (profile.kind) {
    case "missing":
      setAdd("Add to my profile", null);
      statusLine.textContent = `There's no GitHub account called ${usernameInput.value.trim()}.`;
      break;
    case "organization":
      setAdd("Add to my profile", null);
      statusLine.textContent = `${profile.login} is an organization. This only works for personal accounts for now.`;
      break;
    case "no-repo":
      setAdd("Create your profile repo first", createRepoLink(profile.login));
      statusLine.textContent = `GitHub shows a profile README from a repo called ${profile.login}, and you don't have one yet. Create it, then come back here.`;
      break;
    case "ready":
      if (profile.installed) {
        setAdd("Swap to this critter", editLink(profile.login, profile.branch));
        statusLine.textContent = "You already have a critter, so swapping it takes one small edit.";
        swapLines.textContent = `activity: true\n${eggOn() ? "egg: true\n" : ""}critter: ${critter}\ncolour: ${colour}`;
        swapHelp.hidden = false;
      } else {
        setAdd("Add to my profile", addLink(profile.login, profile.branch, critter, colour, eggOn()));
        statusLine.textContent = !profile.readmeHtml
          ? "You don't have a README yet, so this will start one."
          : hasOtherCreature(profile.readmeHtml)
            ? `That's your real README underneath. ${OTHER_CREATURE_LEFTOVERS}`
            : "That's your real README underneath.";
      }
      break;
    case "unknown":
      setAdd("Add to my profile", addLink(profile.login, "main", critter, colour, eggOn()));
      statusLine.textContent = "GitHub isn't answering lookups from here right now, so this shows sample text. The button still works.";
      break;
  }
}

function showReadme(profile: Profile | null): void {
  // The critter may sit inside the old README, so take it out before that goes.
  readmeContent.before(critterParagraph);
  if (profile?.kind === "ready" && profile.readmeHtml) {
    readmeContent.replaceChildren(prepareReadme(profile.readmeHtml, profile.login, profile.branch));
    readmeContent.querySelector(`.${CRITTER_SLOT}`)?.replaceWith(critterParagraph);
  } else if (profile?.kind === "ready") {
    readmeContent.replaceChildren();
  } else {
    readmeContent.replaceChildren(sampleReadme.content.cloneNode(true));
  }
  const known = profile && "login" in profile ? profile.login : "your-name";
  profileName.textContent = known;
}

/** The languages may have changed, which can change the colours everywhere. */
function refreshColours(): void {
  buildColourList();
  renderColourNote();
  applyAccent(wayFor(shown().critter));
  player.load(false);
  drawThumbnails();
}

let lookupNumber = 0;

async function refreshProfile(): Promise<void> {
  const number = ++lookupNumber;
  const name = usernameInput.value.trim().replace(/^@/, "");
  if (!isValidUsername(name)) {
    state.profile = null;
    state.languages = [];
    refreshColours();
    showReadme(null);
    renderAction();
    return;
  }
  statusLine.textContent = `Looking up ${name}…`;
  const profile = await lookUpProfile(name);
  if (number !== lookupNumber) return; // they've typed more since
  state.profile = profile;
  state.languages = "languages" in profile ? profile.languages : [];
  refreshColours();
  showReadme(profile);
  renderAction();
}

let typingTimer = 0;
usernameInput.addEventListener("input", () => {
  clearTimeout(typingTimer);
  typingTimer = window.setTimeout(refreshProfile, 500);
});
usernameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    clearTimeout(typingTimer);
    void refreshProfile();
  }
});

// Coming back from GitHub, they may have just created the repo or added the critter.
window.addEventListener("focus", () => {
  if (state.profile) void refreshProfile();
});

addButton.addEventListener("click", (event) => {
  if (!addButton.hasAttribute("href")) {
    event.preventDefault();
    usernameInput.focus();
  }
});

copySwap.addEventListener("click", async () => {
  await navigator.clipboard.writeText(swapLines.textContent ?? "");
  copySwap.textContent = "Copied";
  setTimeout(() => (copySwap.textContent = "Copy"), 1500);
});

downloadButton.addEventListener("click", () => {
  const { critter, traits } = shown();
  const way = wayFor(critter);
  const blob = new Blob([encodeGif(critter, way, traits) as Uint8Array<ArrayBuffer>], { type: "image/gif" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${critter.id}-${way.id}.gif`;
  link.click();
  URL.revokeObjectURL(link.href);
});

document.querySelectorAll<HTMLInputElement>('input[name="theme"]').forEach((radio) => {
  radio.addEventListener("change", () => {
    preview.dataset.theme = radio.value;
  });
});
const prefersDark = matchMedia("(prefers-color-scheme: dark)").matches;
preview.dataset.theme = prefersDark ? "dark" : "light";
element<HTMLInputElement>(prefersDark ? "theme-dark" : "theme-light").checked = true;

function renderPause(): void {
  pauseButton.textContent = player.playing ? "Pause" : "Play";
  pauseButton.setAttribute("aria-pressed", String(!player.playing));
}
pauseButton.addEventListener("click", () => {
  player.playing = !player.playing;
  renderPause();
});

element("hatch-after").textContent = String(HATCH_AFTER);
eggToggle.addEventListener("change", () => {
  state.egg = eggToggle.checked;
  if (!state.egg) state.eggView = null;
  renderPick(false);
});

critterSearch.addEventListener("input", filterCritters);
critterSearch.addEventListener("search", filterCritters);
critterSearch.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    critterSearch.value = "";
    filterCritters();
    critterSearch.blur();
  } else if (event.key === "Enter") {
    event.preventDefault();
    const firstVisible = critterTiles.find((tile) => !tile.label.hidden);
    if (firstVisible) {
      if (firstVisible.isSurprise) chooseSurprise();
      else choose(firstVisible.critter);
      firstVisible.radio.checked = true;
    }
  }
});

buildCritterList();
renderPause();
showReadme(null);
choose(state.critter);
requestAnimationFrame((time) => {
  player.last = time;
  player.tick(time);
});
