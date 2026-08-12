/**
 * public/injected-observer.js 가 소스(injected-observer.ts)와 일치하는지 검사한다.
 * 파일이 없으면(클린 클론·CI) 먼저 생성한 뒤 비교한다 — gitignore 된 생성물 전제.
 */
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";

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
if (!generated) {
  throw new Error("esbuild produced empty output for injected-observer.");
}

let current = "";
let fileExists = false;
try {
  await access(outfile, constants.F_OK);
  fileExists = true;
  current = await readFile(outfile, "utf8");
} catch (error) {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
  if (code !== "ENOENT") {
    throw error;
  }
}

if (!fileExists) {
  // CI / 클린 워크트리: gitignore 로 추적하지 않으므로 생성 후 통과
  await mkdir(dirname(outfile), { recursive: true });
  await writeFile(outfile, generated, "utf8");
  console.log(
    "Injected observer was missing; generated public/injected-observer.js from source.",
  );
  console.log("Injected observer check passed.");
  process.exit(0);
}

if (generated !== current) {
  throw new Error(
    "public/injected-observer.js is out of date. Run npm run build:inject.",
  );
}

console.log("Injected observer check passed.");
