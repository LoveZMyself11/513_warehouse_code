const STORAGE_UPLOAD_TIMEOUT_MS = 45_000;

export function createStorageUploadFetch(
  fetcher: typeof fetch = fetch,
  timeoutMs = STORAGE_UPLOAD_TIMEOUT_MS,
): typeof fetch {
  return async (input, init) => {
    const requestUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const requestMethod = init?.method ?? (typeof Request !== "undefined" && input instanceof Request ? input.method : "GET");
    if (!requestUrl.includes("/storage/v1/object/") || requestMethod.toUpperCase() !== "POST") {
      return fetcher(input, init);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort(new DOMException("Storage upload timed out", "TimeoutError"));
    }, timeoutMs);
    const upstreamSignal = init?.signal;
    const abortFromUpstream = () => controller.abort(upstreamSignal?.reason);
    if (upstreamSignal?.aborted) abortFromUpstream();
    else upstreamSignal?.addEventListener("abort", abortFromUpstream, { once: true });

    try {
      return await fetcher(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
      upstreamSignal?.removeEventListener("abort", abortFromUpstream);
    }
  };
}
