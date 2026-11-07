/**
 * Colours from github-linguist (MIT), the table GitHub uses for the language bar.
 * https://github.com/github-linguist/linguist
 */
export const LANGUAGE_COLOURS: Readonly<Record<string, string>> = {
  JavaScript: "#f1e05a",
  TypeScript: "#3178c6",
  Python: "#3572A5",
  Java: "#b07219",
  C: "#555555",
  "C++": "#f34b7d",
  "C#": "#7355dd",
  Go: "#00ADD8",
  Rust: "#dea584",
  Ruby: "#701516",
  PHP: "#4F5D95",
  Swift: "#F05138",
  Kotlin: "#A97BFF",
  Dart: "#00B4AB",
  Shell: "#89e051",
  HTML: "#e34c26",
  CSS: "#663399",
  SCSS: "#c6538c",
  Lua: "#000080",
  Perl: "#0298c3",
  R: "#198CE7",
  Scala: "#c22d40",
  Haskell: "#5e5086",
  Elixir: "#8847B9",
  Clojure: "#db5855",
  Vue: "#41b883",
  "Jupyter Notebook": "#DA5B0B",
  "Objective-C": "#438eff",
  PowerShell: "#012456",
  Dockerfile: "#384d54",
  Makefile: "#427819",
  TeX: "#3D6117",
  MATLAB: "#e16737",
  Julia: "#a270ba",
  Zig: "#ec915c",
  Nix: "#7e7eff",
  OCaml: "#ef7a08",
  Svelte: "#ff3e00",
  Erlang: "#B83998",
  Groovy: "#4298b8",
  CoffeeScript: "#244776",
  "F#": "#b845fc",
  Elm: "#60B5CC",
  Astro: "#ff5a03",
};

/** The part of a GitHub repo listing that decides its language. */
export interface RepoLanguage {
  fork: boolean;
  language: string | null;
}

/**
 * The two languages that are the primary one in the most of someone's own repos.
 * Forks and repos with no language don't count, and nor do languages the table
 * has no colour for. Ties go alphabetically, so the answer never flickers.
 */
export function topLanguages(repos: readonly RepoLanguage[]): string[] {
  const counts = new Map<string, number>();
  for (const { fork, language } of repos) {
    if (fork || !language || !Object.hasOwn(LANGUAGE_COLOURS, language)) continue;
    counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  return [...counts]
    .sort(([a, countA], [b, countB]) => countB - countA || (a < b ? -1 : 1))
    .slice(0, 2)
    .map(([language]) => language);
}
