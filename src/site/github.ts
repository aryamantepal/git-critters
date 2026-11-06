// Reads public data straight from the visitor's browser, so there's no server or token.
import { WORKFLOW_PATH } from "./links.ts";

export type Profile =
  | { kind: "missing" }
  | { kind: "organization"; login: string }
  | { kind: "no-repo"; login: string }
  | { kind: "ready"; login: string; branch: string; readmeHtml: string | null; installed: boolean }
  /** GitHub's limit for anonymous lookups is used up, or the network failed. */
  | { kind: "unknown"; login: string };

const API = "https://api.github.com";

async function get(path: string, accept = "application/vnd.github+json"): Promise<Response> {
  return fetch(`${API}${path}`, { headers: { Accept: accept } });
}

class LookupFailed extends Error {}

function assertUsable(response: Response): void {
  if (!response.ok && response.status !== 404) throw new LookupFailed(String(response.status));
}

export async function lookUpProfile(username: string): Promise<Profile> {
  try {
    const userResponse = await get(`/users/${username}`);
    if (userResponse.status === 404) return { kind: "missing" };
    assertUsable(userResponse);
    const user = (await userResponse.json()) as { login: string; type: string };
    const { login } = user;
    if (user.type === "Organization") return { kind: "organization", login };

    const repoResponse = await get(`/repos/${login}/${login}`);
    if (repoResponse.status === 404) return { kind: "no-repo", login };
    assertUsable(repoResponse);
    const repo = (await repoResponse.json()) as { default_branch: string };

    const [readmeResponse, workflowResponse] = await Promise.all([
      get(`/repos/${login}/${login}/readme`, "application/vnd.github.html+json"),
      get(`/repos/${login}/${login}/contents/${WORKFLOW_PATH}`),
    ]);
    assertUsable(readmeResponse);
    assertUsable(workflowResponse);
    return {
      kind: "ready",
      login,
      branch: repo.default_branch,
      readmeHtml: readmeResponse.ok ? await readmeResponse.text() : null,
      installed: workflowResponse.ok,
    };
  } catch {
    return { kind: "unknown", login: username };
  }
}

const REMOVE = "script, style, iframe, object, embed, form, link, meta, base";

/**
 * Prepare someone's README for the preview. GitHub has already sanitised it and the
 * page's content security policy blocks scripts, so this is a second line of defence.
 * It also points relative links at the repo, and drops any critter already in there
 * so the preview doesn't show two.
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
  root.querySelectorAll('img[src$="/critter.gif"]').forEach((image) => {
    image.closest("p")?.remove();
  });

  const fragment = document.createDocumentFragment();
  fragment.append(...root.childNodes);
  return fragment;
}
