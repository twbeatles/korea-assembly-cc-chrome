/**
 * URL 전환 reconcile single-flight 헬퍼.
 * 최신 URL만 처리하고, 성공 시에만 lastKnownUrl을 커밋한다.
 */

export interface UrlReconcileController {
  schedule: (getCurrentUrl: () => string, reconcile: (url: string) => Promise<void>) => void;
  /** 테스트/강제 실행용 즉시 실행 */
  runNow: (url: string, reconcile: (url: string) => Promise<void>) => Promise<void>;
  getLastKnownUrl: () => string;
  setLastKnownUrl: (url: string) => void;
  isInFlight: () => boolean;
}

export function createUrlReconcileController(initialUrl: string): UrlReconcileController {
  let lastKnownUrl = initialUrl;
  let inFlight: Promise<void> | null = null;
  let pendingUrl: string | null = null;
  let scheduledTimer: ReturnType<typeof setTimeout> | null = null;

  const clearScheduledTimer = (): void => {
    if (scheduledTimer !== null) {
      clearTimeout(scheduledTimer);
      scheduledTimer = null;
    }
  };

  const flush = async (reconcile: (url: string) => Promise<void>): Promise<void> => {
    while (pendingUrl !== null) {
      const nextUrl = pendingUrl;
      pendingUrl = null;
      // 성공 시에만 lastKnownUrl 커밋 — 실패 시 폴링/이벤트가 재시도한다.
      await reconcile(nextUrl);
      lastKnownUrl = nextUrl;
    }
  };

  const kick = (
    getCurrentUrl: () => string,
    reconcile: (url: string) => Promise<void>,
  ): void => {
    if (inFlight) {
      return;
    }
    clearScheduledTimer();
    scheduledTimer = setTimeout(() => {
      scheduledTimer = null;
      inFlight = flush(reconcile)
        .catch(() => {
          // schedule 경로: 다음 이벤트/폴링이 재시도
        })
        .finally(() => {
          inFlight = null;
          if (pendingUrl !== null) {
            kick(getCurrentUrl, reconcile);
          }
        });
    }, 0);
  };

  return {
    schedule(getCurrentUrl, reconcile) {
      pendingUrl = getCurrentUrl();
      kick(getCurrentUrl, reconcile);
    },
    async runNow(url, reconcile) {
      pendingUrl = url;
      if (inFlight) {
        await inFlight.catch(() => undefined);
      }
      inFlight = flush(reconcile).finally(() => {
        inFlight = null;
      });
      await inFlight;
    },
    getLastKnownUrl() {
      return lastKnownUrl;
    },
    setLastKnownUrl(url: string) {
      lastKnownUrl = url;
    },
    isInFlight() {
      return inFlight !== null;
    },
  };
}
