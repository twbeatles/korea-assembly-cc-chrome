/**
 * onStartup + onInstalled 중복 실행 방지.
 * 짧은 창 안의 재호출은 직전 결과(또는 in-flight promise)를 재사용한다.
 */

export const STARTUP_PERSISTENCE_DEBOUNCE_MS = 5_000;

export interface StartupPersistenceGuardOptions<T> {
  run: () => Promise<T>;
  now?: () => number;
  debounceMs?: number;
}

export function createStartupPersistenceGuard<T>(): {
  run: (options: StartupPersistenceGuardOptions<T>) => Promise<T>;
  resetForTests: () => void;
} {
  let inFlight: Promise<T> | null = null;
  let lastCompletedAt = 0;
  let lastResult: T | null = null;

  return {
    async run(options) {
      const now = options.now?.() ?? Date.now();
      const debounceMs = options.debounceMs ?? STARTUP_PERSISTENCE_DEBOUNCE_MS;

      if (inFlight) {
        return inFlight;
      }

      if (lastResult !== null && now - lastCompletedAt < debounceMs) {
        return lastResult;
      }

      inFlight = options
        .run()
        .then((result) => {
          lastResult = result;
          lastCompletedAt = options.now?.() ?? Date.now();
          return result;
        })
        .finally(() => {
          inFlight = null;
        });

      return inFlight;
    },
    resetForTests() {
      inFlight = null;
      lastCompletedAt = 0;
      lastResult = null;
    },
  };
}
