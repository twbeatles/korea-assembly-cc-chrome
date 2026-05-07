const RANDOM_TOKEN_BYTE_LENGTH = 16;

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Generates a random token suitable for nonces and de-duplication keys.
 *
 * Order of preference:
 *   1. `crypto.randomUUID()` when available (V8/MV3 service worker context).
 *   2. `crypto.getRandomValues(Uint8Array)` for cryptographically strong fallback.
 *   3. `Date.now() + Math.random()` last-resort fallback for environments where
 *      `crypto` is unavailable (some sandboxed iframes).
 *
 * The token is *not* required to be cryptographically secret in this project;
 * it is used to deduplicate frame messages and identify session records. The
 * helper exists to avoid the previous duplicated fallback patterns spread
 * across multiple modules.
 */
export function createRandomToken(): string {
  if (typeof crypto !== "undefined") {
    if (typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    if (typeof crypto.getRandomValues === "function") {
      const bytes = new Uint8Array(RANDOM_TOKEN_BYTE_LENGTH);
      crypto.getRandomValues(bytes);
      return bytesToHex(bytes);
    }
  }
  return `${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`;
}

/**
 * Generates a random token prefixed by a label. Useful for IDs that should
 * remain readable in log output (e.g., `subtitle_<uuid>`).
 */
export function createPrefixedRandomToken(prefix: string): string {
  return `${prefix}_${createRandomToken()}`;
}
