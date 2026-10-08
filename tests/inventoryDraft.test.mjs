import assert from "node:assert/strict";
import test from "node:test";
import {
  clearInventoryCreateDraft,
  inventoryDraftFromForm,
  readInventoryCreateDraft,
  writeInventoryCreateDraft,
} from "../src/lib/inventoryDraft.ts";

function memoryStorage() {
  const entries = new Map();
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: (key) => entries.delete(key),
  };
}

const draft = {
  name: "Portable speaker",
  specification: "USB-C",
  quantity: "2",
  locationCode: "A2",
  recognitionStatus: "Confirmed",
  reason: "Warehouse count",
};

test("restores the form for the same user without copying file data", () => {
  const storage = memoryStorage();
  const form = new FormData();
  for (const [field, value] of Object.entries(draft)) form.set(field, value);
  form.set("imageFile", new Blob(["photo-bytes"], { type: "image/jpeg" }), "photo.jpg");

  writeInventoryCreateDraft("user-a", inventoryDraftFromForm(form), storage);

  assert.deepEqual(readInventoryCreateDraft("user-a", storage), draft);
  assert.equal(readInventoryCreateDraft("user-b", storage), null);
  assert.equal([...storage.entries.values()][0].includes("photo-bytes"), false);
  assert.equal([...storage.entries.values()][0].includes("imageFile"), false);
});

test("clearing a completed or cancelled draft leaves other users' drafts intact", () => {
  const storage = memoryStorage();
  writeInventoryCreateDraft("user-a", draft, storage);
  writeInventoryCreateDraft("user-b", draft, storage);

  clearInventoryCreateDraft("user-a", storage);

  assert.equal(readInventoryCreateDraft("user-a", storage), null);
  assert.deepEqual(readInventoryCreateDraft("user-b", storage), draft);
});

test("ignores expired and incomplete drafts", () => {
  const storage = memoryStorage();
  writeInventoryCreateDraft("user-a", draft, storage);
  const [key, serialized] = [...storage.entries][0];
  const saved = JSON.parse(serialized);
  storage.setItem(key, JSON.stringify({ ...saved, savedAt: Date.now() - 25 * 60 * 60 * 1000 }));
  assert.equal(readInventoryCreateDraft("user-a", storage), null);
  assert.equal(storage.getItem(key), null);

  storage.setItem(key, JSON.stringify({ ...saved, values: { name: "Incomplete" } }));
  assert.equal(readInventoryCreateDraft("user-a", storage), null);
  assert.equal(storage.getItem(key), null);
});

test("storage denial and corrupt browser state do not break the form", () => {
  const unavailable = {
    getItem() { throw new Error("Storage denied"); },
    setItem() { throw new Error("Storage denied"); },
    removeItem() { throw new Error("Storage denied"); },
  };
  assert.equal(readInventoryCreateDraft("user-a", unavailable), null);
  assert.doesNotThrow(() => writeInventoryCreateDraft("user-a", draft, unavailable));
  assert.doesNotThrow(() => clearInventoryCreateDraft("user-a", unavailable));
  assert.equal(readInventoryCreateDraft(null, unavailable), null);

  const storage = memoryStorage();
  writeInventoryCreateDraft("user-a", draft, storage);
  const key = [...storage.entries.keys()][0];
  storage.setItem(key, "broken-json");
  assert.equal(readInventoryCreateDraft("user-a", storage), null);
});
