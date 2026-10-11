/**
 * 커버리지 보정 버전 가드.
 * vitest.config.ts 의 COVERAGE_CALIBRATED_VITEST_MAJOR 와 설치된
 * vitest / @vitest/coverage-v8 메이저가 일치하는지 확인한다.
 * 커버리지 메이저 업그레이드는 V8 집계 수치를 바꾸어 CI 커버리지 임계를
 * 깨뜨릴 수 있으므로 (2026-10-11 vitest 3→5 사례) 불일치하면 재보정을
 * 요구하고 실패한다.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

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
  const detail = mismatched
    .map(
      ([name, version]) =>
        `${name}@${version} (calibrated: major ${calibratedMajor})`,
    )
    .join(", ");
  throw new Error(
    `Coverage thresholds are calibrated for vitest major ${calibratedMajor}, ` +
      `but installed versions differ: ${detail}. ` +
      "Re-run 'npm run test:coverage', recalibrate thresholds in vitest.config.ts, " +
      "and update COVERAGE_CALIBRATED_VITEST_MAJOR.",
  );
}

console.log(
  `Coverage calibration check passed (vitest major ${calibratedMajor}).`,
);
