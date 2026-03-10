import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { build } from "esbuild";

const outfile = resolve("public", "injected-observer.js");

await mkdir(dirname(outfile), { recursive: true });

await build({
  entryPoints: [resolve("src", "content", "injected-observer.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  outfile,
  sourcemap: false,
  legalComments: "none",
});
