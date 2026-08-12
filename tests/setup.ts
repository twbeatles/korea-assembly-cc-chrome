import "fake-indexeddb/auto";

/**
 * 타임존 고정: CI(Ubuntu UTC) 와 로컬(KST 등) 에서 시계 포맷 테스트가 갈라지지 않게 한다.
 * 개별 테스트가 로컬 시각을 단언해야 하면 formatClockTime(...) 으로 기대값을 만든다.
 */
if (!process.env.TZ) {
  process.env.TZ = "UTC";
}
