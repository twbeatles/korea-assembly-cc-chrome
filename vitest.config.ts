import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      all: true,
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/main.tsx",
        "src/background/service-worker.ts",
        "src/content/content-script.ts",
        "src/shared/message-types.ts",
        "src/storage/types.ts",
      ],
      reporter: ["text", "html"],
      // 비기능 감사 L3: 핵심 경로 회귀 하한 (전역 강제보다 경로별 임계)
      thresholds: {
        "src/content/**/*.ts": {
          statements: 45,
          lines: 45,
          branches: 65,
          functions: 80,
        },
        "src/background/**/*.ts": {
          statements: 35,
          lines: 35,
          branches: 50,
          functions: 75,
        },
        "src/storage/**/*.ts": {
          statements: 75,
          lines: 75,
          branches: 70,
          functions: 80,
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
