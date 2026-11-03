import { context, build } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const outfile = path.join(root, "dist", "spotify-rosetta.js");
const watch = process.argv.includes("--watch");
const packageMetadata = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);

await mkdir(path.dirname(outfile), { recursive: true });

const options = {
  entryPoints: [path.join(root, "src", "extension.ts")],
  outfile,
  bundle: true,
  format: "iife",
  globalName: "SpotifyRosettaBundle",
  platform: "browser",
  target: ["chrome120"],
  sourcemap: watch ? "inline" : false,
  minify: !watch,
  legalComments: "inline",
  banner: {
    js: `/* Spotify Rosetta v${packageMetadata.version} | GPL-3.0-only | Existing lyrics and translations only */`,
  },
  logLevel: "info",
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log("Spotify Rosetta is building in watch mode.");
} else {
  await build(options);
  console.log(`Built ${outfile}`);
}

