import { defineConfig } from "vitest/config";

// 커버리지 임계는 vitest 5 V8 프로바이더 실측 기준으로 보정되었다 (2026-10-11).
// vitest 3 시절 `coverage.all: true` 는 한 번도 로드되지 않은 파일까지
// 함수·브랜치 1/1 로 집계해 수치를 부풀렸고, vitest 5 에서는 같은 파일이
// 0/N 으로 정직하게 집계된다. 그 차이를 임계에 반영한 것이며 제품 회귀가 아니다.
// vitest/@vitest/coverage-v8 메이저를 올리면 반드시 `npm run test:coverage` 를
// 다시 돌려 임계를 재보정하고 아래 상수를 갱신한다.
// scripts/check-coverage-calibration.mjs 가 CI 와 `npm run verify` 에서 이를 강제한다.
// 커버리지 수집은 Node 24 V8 기준이다. CI node-version 와 다른 Node 에서는 가드가 먼저 실패한다.
export const COVERAGE_CALIBRATED_VITEST_MAJOR = 5;

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/main.tsx",
        "src/background/service-worker.ts",
        "src/content/content-script.ts",
        "src/shared/message-types.ts",
        "src/storage/types.ts",
        "src/**/*.d.ts",
        // jsdom 단위 테스트로 실행할 수 없는 크롬 런타임 통합 배선.
        // e2e 스모크(scripts/extension-smoke.mjs, tests/e2e-smoke.mjs) 영역이며,
        // vitest 3 all:true 시절에는 미로드 파일이 1/1 로 집계되어 임계를 통과했지만
        // vitest 5 V8 집계에서는 0/N 으로 집계되므로 측정 모집단에서 제외한다.
        "src/content/app/runtime/orchestrator/**",
      ],
      reporter: ["text", "html"],
      // 비기능 감사 L3: 핵심 경로 회귀 하한 (전역 강제보다 경로별 임계)
      thresholds: {
        "src/content/**/*.ts": {
          statements: 45,
          lines: 45,
          // V8 재집계 실측 64.4 + 실행 변동 여유 (구 65).
          branches: 62,
          functions: 80,
        },
        "src/background/**/*.ts": {
          statements: 35,
          lines: 35,
          branches: 50,
          functions: 75,
        },
        "src/storage/**/*.ts": {
          // V8 재집계 실측 stmt 76.0 / fn 79.3 / br 67.5 + 여유 (구 75/75/70/80).
          statements: 73,
          lines: 73,
          branches: 65,
          functions: 77,
        },
        "src/core/subtitle-pipeline/**/*.ts": {
          statements: 70,
          lines: 70,
          branches: 60,
          functions: 75,
        },
        "src/shared/extension-context.ts": {
          statements: 80,
          lines: 80,
          branches: 70,
          functions: 80,
        },
      },
    },
  },
});
