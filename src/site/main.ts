import { languageColourway } from "../activity/colourway.ts";
import { HATCH_AFTER, HATCHLING_POOL } from "../activity/egg.ts";
import { hasOtherCreature, OTHER_CREATURE_LEFTOVERS } from "../action/readme.ts";
import { egg, FRESH_EGG } from "../critters/egg.ts";
import { findCritter } from "../critters/index.ts";
import { paletteOf, SCALE } from "../engine/critter.ts";
import type { Colourway, Critter } from "../engine/critter.ts";
import { DEFAULT_TRAITS } from "../engine/traits.ts";
import type { Traits } from "../engine/traits.ts";
import { CRITTER_SLOT, lookUpProfile, prepareReadme } from "./github.ts";
import type { Profile } from "./github.ts";
import { addLink, createRepoLink, isValidUsername } from "./links.ts";

function element<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const stage = element<HTMLCanvasElement>("stage");
const usernameInput = element<HTMLInputElement>("username");
const addButton = element<HTMLAnchorElement>("add");
const statusLine = element("status");
const preview = element("preview");
const pauseButton = element<HTMLButtonElement>("pause");
const profileName = element("profile-name");
const readmeContent = element("readme-content");
const critterParagraph = stage.closest("p") as HTMLElement;
const sampleReadme = element<HTMLTemplateElement>("sample-readme");
const addedDialog = element<HTMLDialogElement>("added-dialog");
const addedEgg = element<HTMLCanvasElement>("added-egg");
const possibleHatchlings = element("possible-hatchlings");
const hatchlingSearch = element<HTMLInputElement>("hatchling-search");
const noHatchlings = element("no-hatchlings");
const viewReadme = element<HTMLAnchorElement>("view-readme");
const closeAdded = element<HTMLButtonElement>("close-added");
const doneAdded = element<HTMLButtonElement>("done-added");

const state = {
  languages: [] as string[],
  profile: null as Profile | null,
  previewCritter: egg as Critter,
};

function eggColourway(): Colourway {
  return state.languages.length ? languageColourway(egg, state.languages) : egg.colourways[0];
}

function colourwayFor(critter: Critter): Colourway {
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

const player = {
  context: stage.getContext("2d")!,
  image: null as ImageData | null,
  lookup: new Uint32Array(1) as Uint32Array,
  index: 0,
  last: 0,
  playing: !matchMedia("(prefers-reduced-motion: reduce)").matches,

  load(): void {
    const critter = state.previewCritter;
    if (stage.width !== critter.width || stage.height !== critter.height || !this.image) {
      stage.width = critter.width;
      stage.height = critter.height;
      this.image = this.context.createImageData(critter.width, critter.height);
    }
    stage.style.width = `${critter.width * SCALE}px`;
    stage.setAttribute("aria-label", critter.alt);
    this.lookup = colourLookup(critter, colourwayFor(critter));
    this.index = critter.poster;
    this.draw();
  },

  draw(): void {
    const critter = state.previewCritter;
    const traits = critter === egg ? FRESH_EGG : DEFAULT_TRAITS;
    paint(this.context, this.image!, critter.frame(this.index, traits), this.lookup);
  },

  tick(now: number): void {
    const critter = state.previewCritter;
    if (this.playing) {
      if (now - this.last > 1000) this.last = now;
      if (now - this.last >= critter.delayMs) {
        while (now - this.last >= critter.delayMs) {
          this.index = (this.index + 1) % critter.frames;
          this.last += critter.delayMs;
        }
        this.draw();
      }
    }
    requestAnimationFrame((time) => this.tick(time));
  },
};

/** Draw a poster frame cropped close and pixel-scaled into a thumbnail canvas. */
function drawThumbnail(canvas: HTMLCanvasElement, critter: Critter, way: Colourway, traits: Traits): void {
  const pixels = critter.frame(critter.poster, traits);
  let left = critter.width;
  let right = 0;
  let top = critter.height;
  let bottom = 0;
  for (let y = 0, i = 0; y < critter.height; y++) {
    for (let x = 0; x < critter.width; x++, i++) {
      if (!pixels[i]) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  const full = document.createElement("canvas");
  full.width = critter.width;
  full.height = critter.height;
  const fullContext = full.getContext("2d")!;
  paint(
    fullContext,
    fullContext.createImageData(critter.width, critter.height),
    pixels,
    colourLookup(critter, way),
  );

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

interface HatchlingCard {
  critter: Critter;
  button: HTMLButtonElement;
  canvas: HTMLCanvasElement;
}

const hatchlingCards: HatchlingCard[] = [];

function choosePreview(critter: Critter): void {
  state.previewCritter = critter;
  for (const card of hatchlingCards) card.button.setAttribute("aria-pressed", String(card.critter === critter));
  refreshPreview();
}

function buildPossibleHatchlings(): void {
  hatchlingCards.length = 0;
  possibleHatchlings.replaceChildren();
  for (const id of HATCHLING_POOL) {
    const critter = findCritter(id)!;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "hatchling-card";
    button.setAttribute("aria-pressed", "false");
    button.setAttribute("aria-label", `Preview ${critter.name}`);
    button.addEventListener("click", () => choosePreview(critter));
    const canvas = document.createElement("canvas");
    canvas.width = 168;
    canvas.height = 128;
    canvas.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.textContent = critter.name;
    button.append(canvas, name);
    possibleHatchlings.append(button);
    hatchlingCards.push({ critter, button, canvas });
  }
}

function drawPossibleHatchlings(): void {
  for (const { critter, canvas } of hatchlingCards) {
    drawThumbnail(canvas, critter, colourwayFor(critter), DEFAULT_TRAITS);
  }
}

function filterHatchlings(): void {
  const query = hatchlingSearch.value.trim().toLocaleLowerCase();
  let matches = 0;
  for (const { critter, button } of hatchlingCards) {
    const visible = !query || `${critter.name} ${critter.id}`.toLocaleLowerCase().includes(query);
    button.hidden = !visible;
    if (visible) matches++;
  }
  noHatchlings.hidden = matches > 0;
}

function drawAddedEgg(): void {
  drawThumbnail(addedEgg, egg, eggColourway(), FRESH_EGG);
}

/** The colour that says the most about the egg's current colourway. */
function accentOf(way: Colourway): string {
  const colours = way.colours as Record<string, string>;
  return colours.body ?? Object.values(colours)[2];
}

function refreshPreview(): void {
  const hex = accentOf(colourwayFor(state.previewCritter));
  const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
  const light = 0.299 * r + 0.587 * g + 0.114 * b > 150;
  document.documentElement.style.setProperty("--accent", hex);
  document.documentElement.style.setProperty("--on-accent", light ? "#1a1208" : "#ffffff");
  player.load();
  drawAddedEgg();
  drawPossibleHatchlings();
}

function profileReadmeUrl(login: string): string {
  return `https://github.com/${login}/${login}#readme`;
}

function setAdd(label: string, href: string | null, installs = false): void {
  addButton.textContent = label;
  if (href) addButton.href = href;
  else addButton.removeAttribute("href");
  addButton.classList.toggle("waiting", !href);
  if (installs) addButton.dataset.installs = "true";
  else delete addButton.dataset.installs;
}

function renderAction(): void {
  const { profile } = state;
  if (!profile) {
    setAdd("Add to my GitHub", null);
    statusLine.textContent = usernameInput.value.trim()
      ? "That doesn't look like a GitHub username."
      : "Enter your username to preview the egg on your own profile.";
    return;
  }
  switch (profile.kind) {
    case "missing":
      setAdd("Add to my GitHub", null);
      statusLine.textContent = `There's no GitHub account called ${usernameInput.value.trim()}.`;
      break;
    case "organization":
      setAdd("Add to my GitHub", null);
      statusLine.textContent = `${profile.login} is an organization. This only works for personal accounts for now.`;
      break;
    case "no-repo":
      setAdd("Create your profile repo first", createRepoLink(profile.login));
      statusLine.textContent = `GitHub shows a profile README from a repo called ${profile.login}, and you don't have one yet. Create it, then come back here.`;
      break;
    case "ready":
      if (profile.installed) {
        setAdd("View my README", profileReadmeUrl(profile.login));
        statusLine.textContent = "Your git-critter is already set up and growing with your activity.";
      } else {
        setAdd("Add to my GitHub", addLink(profile.login, profile.branch), true);
        statusLine.textContent = !profile.readmeHtml
          ? "You don't have a README yet, so this will start one."
          : hasOtherCreature(profile.readmeHtml)
            ? `That's your real README underneath. ${OTHER_CREATURE_LEFTOVERS}`
            : "That's your real README underneath.";
      }
      break;
    case "unknown":
      setAdd("Add to my GitHub", addLink(profile.login, "main"), true);
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
  profileName.textContent = profile && "login" in profile ? profile.login : "your-name";
}

const PENDING_INSTALL = "git-critters:pending-install";

function pendingInstall(): string | null {
  try {
    return sessionStorage.getItem(PENDING_INSTALL);
  } catch {
    return null;
  }
}

function rememberInstall(login: string | null): void {
  try {
    if (login) sessionStorage.setItem(PENDING_INSTALL, login);
    else sessionStorage.removeItem(PENDING_INSTALL);
  } catch {
    // The focus check still refreshes the page when storage is unavailable.
  }
}

function showAdded(login: string): void {
  viewReadme.href = profileReadmeUrl(login);
  drawAddedEgg();
  if (!addedDialog.open) addedDialog.showModal();
}

function confirmCompletedInstall(profile: Profile): void {
  const pending = pendingInstall();
  if (
    pending &&
    profile.kind === "ready" &&
    profile.installed &&
    pending.toLocaleLowerCase() === profile.login.toLocaleLowerCase()
  ) {
    rememberInstall(null);
    showAdded(profile.login);
  }
}

let lookupNumber = 0;

async function refreshProfile(): Promise<void> {
  const number = ++lookupNumber;
  const name = usernameInput.value.trim().replace(/^@/, "");
  if (!isValidUsername(name)) {
    state.profile = null;
    state.languages = [];
    refreshPreview();
    showReadme(null);
    renderAction();
    return;
  }
  statusLine.textContent = `Looking up ${name}…`;
  const profile = await lookUpProfile(name);
  if (number !== lookupNumber) return;
  state.profile = profile;
  state.languages = "languages" in profile ? profile.languages : [];
  refreshPreview();
  showReadme(profile);
  renderAction();
  confirmCompletedInstall(profile);
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

window.addEventListener("focus", () => {
  if (state.profile) void refreshProfile();
});

addButton.addEventListener("click", (event) => {
  if (!addButton.hasAttribute("href")) {
    event.preventDefault();
    usernameInput.focus();
    return;
  }
  if (addButton.dataset.installs === "true" && state.profile && "login" in state.profile) {
    rememberInstall(state.profile.login);
    statusLine.textContent = "Commit the file on GitHub, then return here for confirmation.";
  }
});

function closeDialog(): void {
  addedDialog.close();
}

closeAdded.addEventListener("click", closeDialog);
doneAdded.addEventListener("click", closeDialog);
addedDialog.addEventListener("click", (event) => {
  if (event.target === addedDialog) closeDialog();
});

hatchlingSearch.addEventListener("input", filterHatchlings);
hatchlingSearch.addEventListener("search", filterHatchlings);
hatchlingSearch.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    hatchlingSearch.value = "";
    filterHatchlings();
    hatchlingSearch.blur();
  } else if (event.key === "Enter") {
    event.preventDefault();
    const firstVisible = hatchlingCards.find(({ button }) => !button.hidden);
    if (firstVisible) choosePreview(firstVisible.critter);
  }
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
buildPossibleHatchlings();
filterHatchlings();
renderPause();
refreshPreview();
showReadme(null);
renderAction();
requestAnimationFrame((time) => {
  player.last = time;
  player.tick(time);
});
