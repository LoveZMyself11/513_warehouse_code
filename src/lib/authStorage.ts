import type { SupportedStorage } from "@supabase/supabase-js";

const REMEMBER_KEY = "513base-auth-remember";
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface AuthStorageEnvironment {
  localStorage?: StorageLike;
  sessionStorage?: StorageLike;
  memory: Map<string, string>;
}

function browserEnvironment(): AuthStorageEnvironment {
  let localStorage: StorageLike | undefined;
  let sessionStorage: StorageLike | undefined;

  try {
    localStorage = window.localStorage;
  } catch {
    // Embedded browsers can deny access to Web Storage.
  }
  try {
    sessionStorage = window.sessionStorage;
  } catch {
    // Keep an in-memory session when tab storage is unavailable.
  }

  return { localStorage, sessionStorage, memory: new Map() };
}

function safeRead(storage: StorageLike | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeWrite(storage: StorageLike | undefined, key: string, value: string): boolean {
  try {
    if (!storage) return false;
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function safeRemove(storage: StorageLike | undefined, key: string): void {
  try {
    storage?.removeItem(key);
  } catch {
    // Continue clearing the other available stores.
  }
}

function readRememberPreference(environment: AuthStorageEnvironment): boolean {
  const localPreference = safeRead(environment.localStorage, REMEMBER_KEY);
  if (localPreference !== null) return localPreference !== "false";

  const tabPreference = safeRead(environment.sessionStorage, REMEMBER_KEY);
  return tabPreference === null ? true : tabPreference !== "false";
}

function writeRememberPreference(environment: AuthStorageEnvironment, remember: boolean): void {
  const value = String(remember);
  safeWrite(environment.localStorage, REMEMBER_KEY, value);
  safeWrite(environment.sessionStorage, REMEMBER_KEY, value);
}

export function createAuthSessionStorage(
  environment: AuthStorageEnvironment = typeof window === "undefined"
    ? { memory: new Map() }
    : browserEnvironment(),
): {
  storage: SupportedStorage;
  getRememberLogin: () => boolean;
  setRememberLogin: (remember: boolean) => void;
} {
  let rememberLogin = readRememberPreference(environment);
  let lastStorageKey: string | null = null;

  const storage: SupportedStorage = {
    async getItem(key) {
      lastStorageKey = key;

      if (rememberLogin) {
        const persistentValue = safeRead(environment.localStorage, key);
        if (persistentValue !== null) return persistentValue;

        const tabValue = safeRead(environment.sessionStorage, key);
        if (tabValue !== null) {
          if (safeWrite(environment.localStorage, key, tabValue)) {
            safeRemove(environment.sessionStorage, key);
            environment.memory.delete(key);
          }
          return tabValue;
        }
      } else {
        safeRemove(environment.localStorage, key);
        const tabValue = safeRead(environment.sessionStorage, key);
        if (tabValue !== null) return tabValue;
      }

      return environment.memory.get(key) ?? null;
    },
    async setItem(key, value) {
      lastStorageKey = key;

      if (rememberLogin) {
        if (safeWrite(environment.localStorage, key, value)) {
          safeRemove(environment.sessionStorage, key);
          environment.memory.delete(key);
          return;
        }

        if (safeWrite(environment.sessionStorage, key, value)) {
          environment.memory.delete(key);
          return;
        }
      } else {
        safeRemove(environment.localStorage, key);
        if (safeWrite(environment.sessionStorage, key, value)) {
          environment.memory.delete(key);
          return;
        }
      }

      environment.memory.set(key, value);
    },
    async removeItem(key) {
      lastStorageKey = key;
      safeRemove(environment.localStorage, key);
      safeRemove(environment.sessionStorage, key);
      environment.memory.delete(key);
    },
  };

  return {
    storage,
    getRememberLogin: () => rememberLogin,
    setRememberLogin: (remember) => {
      if (remember === rememberLogin) return;
      rememberLogin = remember;
      writeRememberPreference(environment, remember);

      if (!lastStorageKey) return;
      const source = remember ? environment.sessionStorage : environment.localStorage;
      const target = remember ? environment.localStorage : environment.sessionStorage;
      const current = safeRead(source, lastStorageKey)
        ?? safeRead(target, lastStorageKey)
        ?? environment.memory.get(lastStorageKey)
        ?? null;

      if (current === null) {
        if (!remember) safeRemove(environment.localStorage, lastStorageKey);
        return;
      }

      const migrated = safeWrite(target, lastStorageKey, current);
      if (!remember) safeRemove(environment.localStorage, lastStorageKey);
      else if (migrated) safeRemove(environment.sessionStorage, lastStorageKey);
      if (migrated) environment.memory.delete(lastStorageKey);
      else environment.memory.set(lastStorageKey, current);
    },
  };
}

export const authSessionStorage = createAuthSessionStorage();
