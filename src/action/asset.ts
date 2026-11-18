import { rmSync } from "node:fs";

export interface AssetPush {
  gifPath: string;
  branch: string;
  message: string;
  /** The run's time. Truncated to the UTC day, so same-day reruns make the same commit. */
  date: Date;
  remote?: string;
}

/** The README-facing URL of the GIF on the asset branch; a relative src would resolve against the default branch. */
export function assetRawUrl(repository: string, branch: string, gifPath: string): string {
  const path = gifPath.split("/").map(encodeURIComponent).join("/");
  return `https://raw.githubusercontent.com/${repository}/${branch}/${path}`;
}

/**
 * Whether a README image src is this Action's GIF: the relative path, or its raw URL on any
 * branch of the repository, so renaming or removing `branch:` can move it.
 */
export function isCritterSrc(repository: string, gifPath: string): (src: string) => boolean {
  const prefix = `https://raw.githubusercontent.com/${repository}/`;
  const suffix = `/${gifPath.split("/").map(encodeURIComponent).join("/")}`;
  return (src) => src === gifPath || (src.startsWith(prefix) && src.endsWith(suffix) && src.length > prefix.length + suffix.length);
}

/**
 * Push the GIF to the asset branch as a single parentless commit, so the default branch
 * never accumulates binary history. `run` executes git and returns its stdout.
 */
export function pushAssetBranch(push: AssetPush, run: (args: string[], env?: Record<string, string>) => string): string {
  const remote = push.remote ?? "origin";
  const index = ".git/git-critters-asset.index";
  const day = new Date(Date.UTC(push.date.getUTCFullYear(), push.date.getUTCMonth(), push.date.getUTCDate()));
  const stamp = day.toISOString();
  const env = { GIT_INDEX_FILE: index };
  rmSync(index, { force: true });
  try {
    // A throwaway index holding only the GIF, so the commit has no parent and no other files.
    run(["read-tree", "--empty"], env);
    run(["add", "--force", "--", push.gifPath], env);
    const tree = run(["write-tree"], env).trim();
    const commit = run(["commit-tree", tree, "-m", push.message], { ...env, GIT_AUTHOR_DATE: stamp, GIT_COMMITTER_DATE: stamp }).trim();
    run(["push", "--force", remote, `${commit}:refs/heads/${push.branch}`]);
    return commit;
  } finally {
    rmSync(index, { force: true });
  }
}
