import { build } from "esbuild";
import { rmSync, mkdirSync, cpSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });

// Static assets (html/css) go straight to dist/public
cpSync("public", "dist/public", { recursive: true });

// Client bundle (browser)
await build({
  entryPoints: ["src/client/index.ts"],
  bundle: true,
  format: "esm",
  target: "es2020",
  sourcemap: true,
  outfile: "dist/public/bundle.js",
});

// Server bundle (node)
await build({
  entryPoints: ["src/server/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  packages: "external",
  outfile: "dist/server.js",
});

console.log("build: client + server bundled to dist/");
