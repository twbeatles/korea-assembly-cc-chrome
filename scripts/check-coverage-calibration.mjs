/**
 * 툴체인 보정 가드 (커버리지 임계·Node 런타임).
 * vitest.config.ts 의 COVERAGE_CALIBRATED_VITEST_MAJOR 와 설치된
 * vitest / @vitest/coverage-v8 메이저가 일치하는지 확인한다.
 * 커버리지 메이저 업그레이드는 V8 집계 수치를 바꾸어 CI 커버리지 임계를
 * 깨뜨릴 수 있으므로 (2026-10-11 vitest 3→5 사례) 불일치하면 재보정을
 * 요구하고 실패한다.
 * 함께 CI 의 Node 메이저(.github/workflows/ci.yml 의 node-version)와
 * 실행 중인 Node 메이져가 일치하는지 확인한다. 커버리지 수집은 V8 버전에
 * 의존하며 (@vitest/coverage-v8 v5 는 Node 20 에서 0%만 수집) 런타임이
 * 어긋나면 임계 실패가 엉뚱한 수치로 나타나므로 여기서 먼저 잡는다.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const failures = [];

const configText = await readFile(resolve("vitest.config.ts"), "utf8");
const match = configText.match(/COVERAGE_CALIBRATED_VITEST_MAJOR\s*=\s*(\d+)/);
if (!match) {
  throw new Error(
    "COVERAGE_CALIBRATED_VITEST_MAJOR marker not found in vitest.config.ts",
  );
}
const calibratedMajor = Number(match[1]);

const installedVersions = await Promise.all(
  ["vitest", "@vitest/coverage-v8"].map(async (name) => {
    const pkg = await readFile(
      resolve("node_modules", name, "package.json"),
      "utf8",
    ).then(JSON.parse);
    return [name, pkg.version];
  }),
);

const mismatched = installedVersions.filter(
  ([, version]) => Number(String(version).split(".")[0]) !== calibratedMajor,
);

if (mismatched.length > 0) {
  failures.push(
    `coverage thresholds are calibrated for vitest major ${calibratedMajor}, ` +
      `but installed versions differ: ${mismatched
        .map(([name, version]) => `${name}@${version}`)
        .join(", ")}. ` +
      "Re-run 'npm run test:coverage', recalibrate thresholds in vitest.config.ts, " +
      "and update COVERAGE_CALIBRATED_VITEST_MAJOR.",
  );
}

const ciText = await readFile(resolve(".github/workflows/ci.yml"), "utf8");
const ciMatch = ciText.match(/node-version:\s*["']?(\d+)/);
if (!ciMatch) {
  throw new Error("node-version not found in .github/workflows/ci.yml");
}
const ciMajor = Number(ciMatch[1]);
const runningMajor = Number(process.versions.node.split(".")[0]);
if (runningMajor !== ciMajor) {
  failures.push(
    `CI runs Node ${ciMajor} but this machine runs Node ${process.versions.node}. ` +
      "Coverage collection depends on the V8 version " +
      "(@vitest/coverage-v8 v5 collects 0% on Node 20). " +
      `Use Node ${ciMajor} or update ci.yml and recalibrate.`,
  );
}

if (failures.length > 0) {
  throw new Error(`Toolchain calibration failed:\n- ${failures.join("\n- ")}`);
}

console.log(
  `Toolchain calibration check passed (Node ${runningMajor}, vitest major ${calibratedMajor}).`,
);
