// Reads public data straight from the visitor's browser, so there's no server or token.
import { topLanguages } from "../activity/languages.ts";
import type { RepoLanguage } from "../activity/languages.ts";
import { OTHER_CREATURES } from "../action/readme.ts";
import { WORKFLOW_PATH } from "./links.ts";

export type Profile =
  | { kind: "missing" }
  | { kind: "organization"; login: string }
  | { kind: "no-repo"; login: string; languages: string[] }
  | { kind: "ready"; login: string; branch: string; readmeHtml: string | null; installed: boolean; languages: string[] }
  /** GitHub's limit for anonymous lookups is used up, or the network failed. */
  | { kind: "unknown"; login: string };

const API = "https://api.github.com";

async function get(fetchImpl: typeof fetch, path: string, accept = "application/vnd.github+json"): Promise<Response> {
  return fetchImpl(`${API}${path}`, { headers: { Accept: accept } });
}

class LookupFailed extends Error {}

function assertUsable(response: Response): void {
  if (!response.ok && response.status !== 404) throw new LookupFailed(String(response.status));
}

/** The same repo list the Action reads, so the preview and the real critter agree. A failure just means no languages. */
async function lookUpLanguages(login: string, fetchImpl: typeof fetch): Promise<string[]> {
  try {
    const response = await get(fetchImpl, `/users/${login}/repos?per_page=100&type=owner&sort=pushed`);
    return response.ok ? topLanguages((await response.json()) as RepoLanguage[]) : [];
  } catch {
    return [];
  }
}

/**
 * Look up a username, reading `/users` first so a typo or an organization costs one
 * request instead of two. Anonymous callers only get 60 requests an hour per IP.
 */
async function lookUpUncached(username: string, fetchImpl: typeof fetch): Promise<Profile> {
  try {
    const userResponse = await get(fetchImpl, `/users/${username}`);
    if (userResponse.status === 404) return { kind: "missing" };
    assertUsable(userResponse);
    const user = (await userResponse.json()) as { login: string; type: string };
    const { login } = user;
    if (user.type === "Organization") return { kind: "organization", login };

    const [repoResponse, languages] = await Promise.all([
      get(fetchImpl, `/repos/${login}/${login}`),
      lookUpLanguages(login, fetchImpl),
    ]);
    if (repoResponse.status === 404) return { kind: "no-repo", login, languages };
    assertUsable(repoResponse);
    const repo = (await repoResponse.json()) as { default_branch: string };

    const [readmeResponse, workflowResponse] = await Promise.all([
      get(fetchImpl, `/repos/${login}/${login}/readme`, "application/vnd.github.html+json"),
      get(fetchImpl, `/repos/${login}/${login}/contents/${WORKFLOW_PATH}`),
    ]);
    assertUsable(readmeResponse);
    assertUsable(workflowResponse);
    return {
      kind: "ready",
      login,
      branch: repo.default_branch,
      readmeHtml: readmeResponse.ok ? await readmeResponse.text() : null,
      installed: workflowResponse.ok,
      languages,
    };
  } catch {
    return { kind: "unknown", login: username };
  }
}

/** Resolved profiles wait in sessionStorage this long before they're looked up again. */
const PROFILE_CACHE_TTL_MS = 5 * 60 * 1000;
const PROFILE_CACHE_PREFIX = "git-critters:profile:";

type ProfileStorage = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): ProfileStorage | null {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
}

function readCachedProfile(key: string, storage: ProfileStorage | null, now: number): Profile | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const cached = JSON.parse(raw) as { at: number; profile: Profile };
    if (cached.profile.kind === "unknown" || cached.profile.kind === "no-repo" || now - cached.at > PROFILE_CACHE_TTL_MS) return null;
    return cached.profile;
  } catch {
    return null;
  }
}

function writeCachedProfile(key: string, profile: Profile, storage: ProfileStorage | null, now: number): void {
  // A profile repo may be created before the visitor's next focus or Enter refresh.
  if (!storage || profile.kind === "unknown" || profile.kind === "no-repo") return;
  try {
    storage.setItem(key, JSON.stringify({ at: now, profile }));
  } catch {
    // A full or blocked storage just means the next lookup goes to GitHub again.
  }
}

export interface LookupOptions {
  /** Skip the cache, for when the answer may have changed since it was stored. */
  bypassCache?: boolean;
  fetchImpl?: typeof fetch;
  storage?: ProfileStorage | null;
  now?: () => number;
}

export async function lookUpProfile(username: string, options: LookupOptions = {}): Promise<Profile> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const now = options.now ?? Date.now;
  const key = PROFILE_CACHE_PREFIX + username.toLowerCase();
  if (!options.bypassCache) {
    const cached = readCachedProfile(key, storage, now());
    if (cached) return cached;
  }
  const profile = await lookUpUncached(username, fetchImpl);
  writeCachedProfile(key, profile, storage, now());
  return profile;
}

export const CRITTER_SLOT = "critter-slot";

function isCritter(container: Element): boolean {
  return container.matches('img[src$="/critter.gif"]') || container.querySelector('img[src$="/critter.gif"]') !== null;
}

const REMOVE = "script, style, iframe, object, embed, form, link, meta, base";

/**
 * Prepare someone's README for the preview. GitHub has already sanitised it and the
 * page's content security policy blocks scripts, so this is a second line of defence.
 * It also points relative links at the repo. The Action puts the critter where an
 * earlier critter or another creature like git-koi's is, so the first of those becomes
 * an empty element with the class CRITTER_SLOT for the preview to fill, and any others go.
 */
export function prepareReadme(html: string, login: string, branch: string): DocumentFragment {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const root = doc.querySelector("article") ?? doc.body;
  root.querySelectorAll(REMOVE).forEach((element) => element.remove());
  // GitHub's heading links only show on hover there, and have no styling here.
  root.querySelectorAll("a.anchor").forEach((element) => element.remove());

  const raw = `https://raw.githubusercontent.com/${login}/${login}/${branch}/`;
  const blob = `https://github.com/${login}/${login}/blob/${branch}/`;
  const resolve = (value: string, base: string): string | null => {
    try {
      const url = new URL(value, base);
      return url.protocol === "https:" || url.protocol === "http:" || url.protocol === "mailto:" ? url.href : null;
    } catch {
      return null;
    }
  };

  for (const element of root.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      if (attribute.name.startsWith("on") || attribute.name === "style") {
        element.removeAttribute(attribute.name);
      }
    }
  }
  root.querySelectorAll("img").forEach((image) => {
    const src = resolve(image.getAttribute("src") ?? "", raw);
    if (src) image.setAttribute("src", src);
    else image.removeAttribute("src");
    image.setAttribute("loading", "lazy");
  });
  root.querySelectorAll("source").forEach((source) => {
    const srcset = resolve(source.getAttribute("srcset") ?? "", raw);
    if (srcset) source.setAttribute("srcset", srcset);
    else source.remove();
  });
  root.querySelectorAll("a").forEach((link) => {
    const href = resolve(link.getAttribute("href") ?? "", blob);
    if (href) link.setAttribute("href", href);
    else link.removeAttribute("href");
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener noreferrer");
  });
  const creatures = new Set<Element>();
  root.querySelectorAll('img[src$="/critter.gif"]').forEach((image) => {
    creatures.add(image.closest("p") ?? image.closest("a") ?? image);
  });
  root.querySelectorAll("a").forEach((link) => {
    const href = link.getAttribute("href") ?? "";
    const paragraph = link.closest("p");
    if (paragraph?.querySelector("img") && OTHER_CREATURES.some((repo) => href.includes(repo))) {
      creatures.add(paragraph);
    }
  });
  // The Action prefers an earlier critter's spot, so the preview does too.
  const ordered = [...creatures].sort((a, b) => Number(isCritter(b)) - Number(isCritter(a)));
  ordered.forEach((paragraph, index) => {
    if (index === 0) {
      const slot = doc.createElement("div");
      slot.className = CRITTER_SLOT;
      paragraph.replaceWith(slot);
    } else {
      paragraph.remove();
    }
  });

  const fragment = document.createDocumentFragment();
  fragment.append(...root.childNodes);
  return fragment;
}
