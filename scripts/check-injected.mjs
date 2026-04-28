import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { build } from "esbuild";

const outfile = resolve("public", "injected-observer.js");

const result = await build({
  entryPoints: [resolve("src", "content", "injected-observer.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  write: false,
  sourcemap: false,
  legalComments: "none",
});

const generated = result.outputFiles[0]?.text ?? "";
const current = await readFile(outfile, "utf8");

if (generated !== current) {
  throw new Error("public/injected-observer.js is out of date. Run npm run build:inject.");
}

console.log("Injected observer check passed.");
