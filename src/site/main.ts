import { languageColourway, LANGUAGES_COLOURWAY } from "../activity/colourway.ts";
import { critters } from "../critters/index.ts";
import { paletteOf, SCALE } from "../engine/critter.ts";
import type { Colourway, Critter } from "../engine/critter.ts";
import { encodeGif } from "../engine/gif.ts";
import { DEFAULT_TRAITS } from "../engine/traits.ts";
import type { Traits } from "../engine/traits.ts";
import { lookUpProfile, prepareReadme } from "./github.ts";
import type { Profile } from "./github.ts";
import { addLink, createRepoLink, editLink, isValidUsername } from "./links.ts";

function element<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const stage = element<HTMLCanvasElement>("stage");
const critterList = element("critters");
const colourList = element("colours");
const colourNote = element("colour-note");
const traitList = element("traits");
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
const sampleReadme = element<HTMLTemplateElement>("sample-readme");

const state = {
  critter: critters[0],
  /** Colours from the visitor's languages, which is the default, rather than a fixed colourway. */
  useLanguages: true,
  languages: [] as string[],
  traits: { ...DEFAULT_TRAITS } as Traits,
  profile: null as Profile | null,
};
const chosenWays = new Map<string, Colourway>(critters.map((c) => [c.id, c.colourways[0]]));

/** The colours in use: the visitor's languages if they have any, else the critter's first colourway. */
function wayFor(critter: Critter): Colourway {
  if (!state.useLanguages) return chosenWays.get(critter.id)!;
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

  load(critter: Critter, way: Colourway, restart: boolean): void {
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
    paint(this.context, this.image!, state.critter.frame(this.index, state.traits), this.lookup);
  },

  tick(now: number): void {
    const { delayMs } = state.critter;
    if (this.playing) {
      // A tab that was in the background shouldn't try to catch up.
      if (now - this.last > 1000) this.last = now;
      if (now - this.last >= delayMs) {
        while (now - this.last >= delayMs) {
          this.index = (this.index + 1) % state.critter.frames;
          this.last += delayMs;
        }
        this.draw();
      }
    }
    requestAnimationFrame((time) => this.tick(time));
  },
};

/** Draw a critter's poster frame, cropped close and scaled up by a whole number. */
function drawThumbnail(canvas: HTMLCanvasElement, critter: Critter, way: Colourway): void {
  const { width, height } = critter;
  const pixels = critter.frame(critter.poster, state.traits);
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

function buildCritterList(): void {
  for (const critter of critters) {
    const label = document.createElement("label");
    label.className = "critter";
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "critter";
    radio.value = critter.id;
    radio.checked = critter === state.critter;
    radio.addEventListener("change", () => choose(critter));
    const canvas = document.createElement("canvas");
    canvas.width = 168;
    canvas.height = 128;
    canvas.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.textContent = critter.name;
    label.append(radio, canvas, name);
    critterList.append(label);
    thumbnails.set(critter.id, canvas);
    drawThumbnail(canvas, critter, wayFor(critter));
  }
}

function buildColourList(): void {
  colourList.replaceChildren();
  const { critter } = state;
  const chosen = chosenWays.get(critter.id)!;
  const options: [string, Colourway, () => void][] = [
    ["My languages", wayFor(critter), () => chooseColour(null)],
    ...critter.colourways.map((way): [string, Colourway, () => void] => [way.name, way, () => chooseColour(way)]),
  ];
  options.forEach(([name, way, pick], n) => {
    const label = document.createElement("label");
    label.className = "colour";
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "colour";
    radio.value = n === 0 ? LANGUAGES_COLOURWAY : way.id;
    radio.checked = n === 0 ? state.useLanguages : !state.useLanguages && way.id === chosen.id;
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
  if (!state.useLanguages) {
    colourNote.textContent = "";
  } else if (state.languages.length) {
    colourNote.textContent = `Coloured from your most-used languages: ${state.languages.join(" and ")}.`;
  } else if (state.profile) {
    colourNote.textContent = `No languages to colour from, so this shows ${state.critter.name}'s first colours.`;
  } else {
    colourNote.textContent = `Enter your username to colour it from your languages. Until then this shows ${state.critter.name}'s first colours.`;
  }
}

const TRAIT_ROWS = [
  { key: "stage", label: "Size", options: ["Hatchling", "Young", "Grown", "Elder"] },
  { key: "marks", label: "Marks", options: ["None", "7 days", "30 days", "100 days"] },
  { key: "mood", label: "Yesterday", options: ["Resting", "Steady", "Lively"] },
] as const;

function buildTraitList(): void {
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
    row.options.forEach((text, n) => {
      const value = row.key === "mood" ? text.toLowerCase() : n;
      const label = document.createElement("label");
      label.className = "colour plain";
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = `trait-${row.key}`;
      radio.checked = state.traits[row.key] === value;
      radio.addEventListener("change", () => {
        Object.assign(state.traits, { [row.key]: value });
        player.load(state.critter, wayFor(state.critter), false);
        critters.forEach((critter) => drawThumbnail(thumbnails.get(critter.id)!, critter, wayFor(critter)));
      });
      const span = document.createElement("span");
      span.textContent = text;
      label.append(radio, span);
      options.append(label);
    });
    group.append(heading, options);
    traitList.append(group);
  }
}

/** The colour that says the most about a colourway. */
function swatchOf(way: Colourway): string {
  const colours = way.colours as Record<string, string>;
  return colours.body ?? colours.bell ?? Object.values(colours)[2];
}

function applyAccent(way: Colourway): void {
  const hex = swatchOf(way);
  const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
  // Keep the button's label readable on whatever colour it takes on.
  const light = 0.299 * r + 0.587 * g + 0.114 * b > 150;
  document.documentElement.style.setProperty("--accent", hex);
  document.documentElement.style.setProperty("--on-accent", light ? "#1a1208" : "#ffffff");
}

function choose(critter: Critter): void {
  state.critter = critter;
  const way = wayFor(critter);
  blurb.textContent = critter.blurb;
  buildColourList();
  renderColourNote();
  applyAccent(way);
  player.load(critter, way, true);
  renderAction();
}

/** Pick a fixed colourway, or null for the visitor's languages. */
function chooseColour(fixed: Colourway | null): void {
  state.useLanguages = fixed === null;
  if (fixed) chosenWays.set(state.critter.id, fixed);
  const way = wayFor(state.critter);
  applyAccent(way);
  player.load(state.critter, way, false);
  drawThumbnail(thumbnails.get(state.critter.id)!, state.critter, way);
  renderColourNote();
  renderAction();
}

/** The colour that goes in the workflow: "languages", or a fixed colourway's id. */
function colourId(): string {
  return state.useLanguages ? LANGUAGES_COLOURWAY : chosenWays.get(state.critter.id)!.id;
}

function setAdd(label: string, href: string | null): void {
  addButton.textContent = label;
  if (href) addButton.href = href;
  else addButton.removeAttribute("href");
  addButton.classList.toggle("waiting", !href);
}

/** Update the button and the status line to match the critter and whoever's looking. */
function renderAction(): void {
  const { profile, critter } = state;
  const colour = colourId();
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
        swapLines.textContent = `activity: true\ncritter: ${critter.id}\ncolour: ${colour}`;
        swapHelp.hidden = false;
      } else {
        setAdd("Add to my profile", addLink(profile.login, profile.branch, critter.id, colour));
        statusLine.textContent = profile.readmeHtml
          ? "That's your real README underneath."
          : "You don't have a README yet, so this will start one.";
      }
      break;
    case "unknown":
      setAdd("Add to my profile", addLink(profile.login, "main", critter.id, colour));
      statusLine.textContent = "GitHub isn't answering lookups from here right now, so this shows sample text. The button still works.";
      break;
  }
}

function showReadme(profile: Profile | null): void {
  if (profile?.kind === "ready" && profile.readmeHtml) {
    readmeContent.replaceChildren(prepareReadme(profile.readmeHtml, profile.login, profile.branch));
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
  const way = wayFor(state.critter);
  applyAccent(way);
  player.load(state.critter, way, false);
  critters.forEach((critter) => drawThumbnail(thumbnails.get(critter.id)!, critter, wayFor(critter)));
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
  const { critter, traits } = state;
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

buildCritterList();
buildTraitList();
renderPause();
showReadme(null);
choose(state.critter);
requestAnimationFrame((time) => {
  player.last = time;
  player.tick(time);
});
