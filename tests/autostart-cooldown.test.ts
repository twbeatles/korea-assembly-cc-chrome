import { afterEach, describe, expect, it } from "vitest";

import {
  clearAutoStartCooldown,
  hasAutoStartCooldown,
  rememberAutoStartCooldown,
} from "../src/content/runtime/autostart-cooldown";

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => {
      store.clear();
    },
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => [...store.keys()][index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
}

function createThrowingStorage(): Storage {
  const denied = () => {
    throw new Error("session storage unavailable");
  };
  return {
    get length(): number {
      return denied() as never;
    },
    clear: denied,
    getItem: denied,
    key: denied,
    removeItem: denied,
    setItem: denied,
  };
}

const originalDescriptor = Object.getOwnPropertyDescriptor(
  window,
  "sessionStorage",
);

function installStorage(value: Storage | undefined): void {
  Object.defineProperty(window, "sessionStorage", {
    value,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  if (originalDescriptor) {
    Object.defineProperty(window, "sessionStorage", originalDescriptor);
  } else {
    delete (window as unknown as Record<string, unknown>).sessionStorage;
  }
});

describe("autostart cooldown", () => {
  it("ignores cooldown bookkeeping outside the top frame without touching storage", () => {
    installStorage(createThrowingStorage());
    expect(() => {
      rememberAutoStartCooldown(false);
      clearAutoStartCooldown(false);
    }).not.toThrow();
    expect(hasAutoStartCooldown(false)).toBe(false);
  });

  it("remembers and clears the top-frame cooldown", () => {
    installStorage(createMemoryStorage());
    expect(hasAutoStartCooldown(true)).toBe(false);
    rememberAutoStartCooldown(true);
    expect(hasAutoStartCooldown(true)).toBe(true);
    clearAutoStartCooldown(true);
    expect(hasAutoStartCooldown(true)).toBe(false);
  });

  it("treats missing session storage as no cooldown", () => {
    installStorage(undefined);
    expect(hasAutoStartCooldown(true)).toBe(false);
    expect(() => {
      rememberAutoStartCooldown(true);
      clearAutoStartCooldown(true);
    }).not.toThrow();
  });

  it("degrades gracefully when session storage throws", () => {
    installStorage(createThrowingStorage());
    expect(() => {
      rememberAutoStartCooldown(true);
      clearAutoStartCooldown(true);
    }).not.toThrow();
    expect(hasAutoStartCooldown(true)).toBe(false);
  });
});
