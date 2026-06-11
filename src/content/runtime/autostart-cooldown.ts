const AUTO_START_COOLDOWN_STORAGE_PREFIX = "assembly-subtitle-explicit-stop:";

function getAutoStartCooldownKey(): string {
  try {
    return `${AUTO_START_COOLDOWN_STORAGE_PREFIX}${window.location.pathname}${window.location.search}`;
  } catch {
    return AUTO_START_COOLDOWN_STORAGE_PREFIX;
  }
}

export function rememberAutoStartCooldown(isTopFrame: boolean): void {
  if (!isTopFrame) {
    return;
  }
  try {
    window.sessionStorage?.setItem(getAutoStartCooldownKey(), "1");
  } catch {
    // sessionStorage may be unavailable in restricted frame contexts.
  }
}

export function clearAutoStartCooldown(isTopFrame: boolean): void {
  if (!isTopFrame) {
    return;
  }
  try {
    window.sessionStorage?.removeItem(getAutoStartCooldownKey());
  } catch {
    // sessionStorage may be unavailable in restricted frame contexts.
  }
}

export function hasAutoStartCooldown(isTopFrame: boolean): boolean {
  if (!isTopFrame) {
    return false;
  }
  try {
    return window.sessionStorage?.getItem(getAutoStartCooldownKey()) === "1";
  } catch {
    return false;
  }
}
