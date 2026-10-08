import assert from "node:assert/strict";
import test from "node:test";
import { createAuthSessionStorage } from "../src/lib/authStorage.ts";

function createStorage(initial = new Map(), blocked = false) {
  return {
    getItem(key) {
      if (blocked) throw new Error("Storage access denied");
      return initial.get(key) ?? null;
    },
    setItem(key, value) {
      if (blocked) throw new Error("Storage access denied");
      initial.set(key, value);
    },
    removeItem(key) {
      if (blocked) throw new Error("Storage access denied");
      initial.delete(key);
    },
  };
}

function createEnvironment({ localStorage, sessionStorage } = {}) {
  return { localStorage, sessionStorage, memory: new Map() };
}

test("keeps the legacy Supabase key and restores remembered sessions after reload", async () => {
  const localData = new Map();
  const localStorage = createStorage(localData);
  const key = "sb-existing-project-auth-token";
  const previousSession = JSON.stringify({ access_token: "old-access", refresh_token: "old-refresh" });
  localStorage.setItem(key, previousSession);

  const original = createAuthSessionStorage(createEnvironment({ localStorage, sessionStorage: createStorage() }));
  assert.equal(original.getRememberLogin(), true);
  assert.equal(await original.storage.getItem(key), previousSession);

  const newSession = JSON.stringify({ access_token: "new-access", refresh_token: "new-refresh" });
  await original.storage.setItem(key, newSession);
  const reopened = createAuthSessionStorage(createEnvironment({ localStorage, sessionStorage: createStorage() }));
  assert.equal(await reopened.storage.getItem(key), newSession);
});

test("unchecking remember-login migrates to this tab and prevents a new-tab restore", async () => {
  const localStorage = createStorage();
  const sessionData = new Map();
  const sessionStorage = createStorage(sessionData);
  const key = "sb-project-auth-token";
  const auth = createAuthSessionStorage(createEnvironment({ localStorage, sessionStorage }));

  assert.equal(auth.getRememberLogin(), true);
  await auth.storage.setItem(key, "session-data");
  auth.setRememberLogin(false);
  assert.equal(auth.getRememberLogin(), false);
  assert.equal(localStorage.getItem(key), null);
  assert.equal(await auth.storage.getItem(key), "session-data");

  const sameTabReload = createAuthSessionStorage(createEnvironment({ localStorage, sessionStorage }));
  assert.equal(sameTabReload.getRememberLogin(), false);
  assert.equal(await sameTabReload.storage.getItem(key), "session-data");

  const reopenedTab = createAuthSessionStorage(createEnvironment({ localStorage, sessionStorage: createStorage() }));
  assert.equal(await reopenedTab.storage.getItem(key), null);
});

test("checking remember-login moves a tab session back to persistent storage", async () => {
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  const key = "sb-project-auth-token";
  const auth = createAuthSessionStorage(createEnvironment({ localStorage, sessionStorage }));

  auth.setRememberLogin(false);
  await auth.storage.setItem(key, "session-data");
  auth.setRememberLogin(true);

  assert.equal(localStorage.getItem(key), "session-data");
  assert.equal(sessionStorage.getItem(key), null);
  const reopened = createAuthSessionStorage(createEnvironment({ localStorage, sessionStorage: createStorage() }));
  assert.equal(await reopened.storage.getItem(key), "session-data");
});

test("falls back to tab storage and then memory when browser storage is inaccessible", async () => {
  const key = "sb-project-auth-token";
  const tabData = new Map();
  const withBlockedLocalStorage = createAuthSessionStorage(createEnvironment({
    localStorage: createStorage(new Map(), true),
    sessionStorage: createStorage(tabData),
  }));
  await withBlockedLocalStorage.storage.setItem(key, "tab-session");
  const reopenedInTab = createAuthSessionStorage(createEnvironment({
    localStorage: createStorage(new Map(), true),
    sessionStorage: createStorage(tabData),
  }));
  assert.equal(await reopenedInTab.storage.getItem(key), "tab-session");

  const memoryOnly = createAuthSessionStorage(createEnvironment({
    localStorage: createStorage(new Map(), true),
    sessionStorage: createStorage(new Map(), true),
  }));
  await memoryOnly.storage.setItem(key, "memory-session");
  assert.equal(await memoryOnly.storage.getItem(key), "memory-session");

  const newPage = createAuthSessionStorage(createEnvironment({
    localStorage: createStorage(new Map(), true),
    sessionStorage: createStorage(new Map(), true),
  }));
  assert.equal(await newPage.storage.getItem(key), null);
});

test("logout clears local, tab, and memory session copies", async () => {
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  const key = "sb-project-auth-token";
  const auth = createAuthSessionStorage(createEnvironment({ localStorage, sessionStorage }));

  await auth.storage.setItem(key, "session-data");
  await auth.storage.removeItem(key);
  assert.equal(localStorage.getItem(key), null);
  assert.equal(sessionStorage.getItem(key), null);
  assert.equal(await auth.storage.getItem(key), null);
});
