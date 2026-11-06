// Bundle the Action and the site. With --serve, also serve the site for local work.
import { build, context } from "esbuild";
import type { BuildOptions } from "esbuild";

await build({
  entryPoints: ["src/action/main.ts"],
  outfile: "dist/action.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  logLevel: "warning",
});

const site: BuildOptions = {
  entryPoints: ["src/site/main.ts"],
  outfile: "site/app.js",
  bundle: true,
  format: "esm",
  target: "es2022",
  minify: true,
  logLevel: "warning",
};

if (process.argv.includes("--serve")) {
  const ctx = await context(site);
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: "site", host: "127.0.0.1", port: 8000 });
  console.log(`Preview the site at http://127.0.0.1:${port}`);
} else {
  await build(site);
  console.log("Built dist/action.cjs and site/app.js");
}
