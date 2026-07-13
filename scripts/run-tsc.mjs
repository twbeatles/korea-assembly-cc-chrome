/**
 * TypeScript 6/7 병행 typecheck 헬퍼.
 * npm .bin/tsc 는 dual-install 시 어느 쪽을 가리키는지 불안정하므로
 * 패키지 경로로 명시적으로 호출한다.
 *
 * 사용법:
 *   node scripts/run-tsc.mjs 6
 *   node scripts/run-tsc.mjs 7
 *   node scripts/run-tsc.mjs 7 --singleThreaded
 */
import { accessSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

const versionArg = process.argv[2];
const extraArgs = process.argv.slice(3);

if (versionArg !== "6" && versionArg !== "7") {
  console.error("Usage: node scripts/run-tsc.mjs <6|7> [tsc flags...]");
  process.exit(2);
}

function resolveTscBin(version) {
  if (version === "7") {
    const pkgDir = path.dirname(require.resolve("typescript-7/package.json"));
    return path.join(pkgDir, "bin", "tsc");
  }
  const pkgDir = path.dirname(require.resolve("typescript/package.json"));
  // 일반 typescript@6 는 bin/tsc, @typescript/typescript6 별칭은 bin/tsc6
  const tsc = path.join(pkgDir, "bin", "tsc");
  const tsc6 = path.join(pkgDir, "bin", "tsc6");
  try {
    accessSync(tsc);
    return tsc;
  } catch {
    return tsc6;
  }
}

const tscBin = resolveTscBin(versionArg);
const projects = ["tsconfig.json", "tsconfig.node.json"];

for (const project of projects) {
  const args = [tscBin, "-p", project, "--noEmit", ...extraArgs];
  const result = spawnSync(process.execPath, args, {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
