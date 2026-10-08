import assert from "node:assert/strict";
import test from "node:test";
import { createStorageUploadFetch } from "../src/lib/uploadFetch.ts";

test("times out a stalled Storage upload and aborts its fetch", async () => {
  let aborted = false;
  const fetcher = (_input, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => {
      aborted = true;
      reject(init.signal.reason);
    }, { once: true });
  });
  const timedFetch = createStorageUploadFetch(fetcher, 10);

  await assert.rejects(
    timedFetch("https://project.supabase.co/storage/v1/object/inventory-images/items/photo.webp", { method: "POST" }),
    { name: "TimeoutError", message: "Storage upload timed out" },
  );
  assert.equal(aborted, true);
});

test("does not impose the Storage upload timeout on ordinary API requests", async () => {
  const response = new Response("ok");
  const fetcher = async () => response;
  const timedFetch = createStorageUploadFetch(fetcher, 1);

  assert.equal(await timedFetch("https://project.supabase.co/rest/v1/inventory_items"), response);
  assert.equal(await timedFetch("https://project.supabase.co/storage/v1/object/inventory-images/items/photo.webp", { method: "GET" }), response);
});

test("preserves cancellation from a caller for Storage uploads", async () => {
  const upstream = new AbortController();
  const fetcher = (_input, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
  });
  const timedFetch = createStorageUploadFetch(fetcher, 1_000);
  const request = timedFetch("https://project.supabase.co/storage/v1/object/inventory-images/items/photo.webp", {
    method: "POST",
    signal: upstream.signal,
  });
  upstream.abort(new DOMException("Cancelled by caller", "AbortError"));

  await assert.rejects(request, { name: "AbortError", message: "Cancelled by caller" });
});
