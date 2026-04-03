import { SESSION_LIBRARY_REVISION_STORAGE_KEY } from "../../shared/constants";
import { resetPersistRecoveryStateForTests } from "../persist-recovery";
import {
  clearChromeFallbackRecordsForTests,
  resetFallbackModuleState,
} from "./fallback";
import { resetIndexedDbForTests } from "./db";
import { resetSessionStoreModuleState } from "./state";

export async function resetSessionStoreForTestsInternal(): Promise<void> {
  resetFallbackModuleState();
  await clearChromeFallbackRecordsForTests();
  await resetPersistRecoveryStateForTests();

  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    await chrome.storage.local.remove(SESSION_LIBRARY_REVISION_STORAGE_KEY);
  }

  await resetIndexedDbForTests();
  resetSessionStoreModuleState();
}
