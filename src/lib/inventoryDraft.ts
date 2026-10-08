export interface InventoryCreateDraft {
  name: string;
  specification: string;
  quantity: string;
  locationCode: string;
  recognitionStatus: string;
  reason: string;
}

const DRAFT_FIELDS = ["name", "specification", "quantity", "locationCode", "recognitionStatus", "reason"] as const;
const MAX_DRAFT_AGE_MS = 24 * 60 * 60 * 1000;
const draftKey = (authUserId: string) => `513base:inventory-create-draft:v1:${authUserId}`;

function browserStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function inventoryDraftFromForm(form: FormData): InventoryCreateDraft {
  return Object.fromEntries(DRAFT_FIELDS.map((field) => [field, String(form.get(field) ?? "")])) as unknown as InventoryCreateDraft;
}

export function readInventoryCreateDraft(authUserId: string | null, storage = browserStorage()): InventoryCreateDraft | null {
  if (!authUserId || !storage) return null;
  try {
    const serialized = storage.getItem(draftKey(authUserId));
    if (!serialized) return null;
    const saved = JSON.parse(serialized);
    if (!saved || saved.version !== 1 || typeof saved.savedAt !== "number" || Date.now() - saved.savedAt > MAX_DRAFT_AGE_MS
      || !saved.values || !DRAFT_FIELDS.every((field) => typeof saved.values[field] === "string")) {
      storage.removeItem(draftKey(authUserId));
      return null;
    }
    return Object.fromEntries(DRAFT_FIELDS.map((field) => [field, saved.values[field]])) as unknown as InventoryCreateDraft;
  } catch {
    return null;
  }
}

export function writeInventoryCreateDraft(authUserId: string | null, values: InventoryCreateDraft, storage = browserStorage()): void {
  if (!authUserId || !storage) return;
  try {
    storage.setItem(draftKey(authUserId), JSON.stringify({ version: 1, savedAt: Date.now(), values }));
  } catch {
    // Private browsing or a full storage quota must not interrupt the form.
  }
}

export function clearInventoryCreateDraft(authUserId: string | null, storage = browserStorage()): void {
  if (!authUserId || !storage) return;
  try {
    storage.removeItem(draftKey(authUserId));
  } catch {
    // The form can still be dismissed when browser storage is unavailable.
  }
}
