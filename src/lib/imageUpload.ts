const MAX_DIMENSION = 1920;
const MAX_STANDARD_UPLOAD = 5 * 1024 * 1024;

const waitForBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

async function decodeImage(file: File): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Fall back to the image element for embedded browsers with partial bitmap support.
    }
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Image decode failed"));
    });
    image.src = objectUrl;
    await loaded;
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

export async function prepareInventoryImage(file: File): Promise<File> {
  if (file.size <= 320 * 1024) return file;

  let decoded: Awaited<ReturnType<typeof decodeImage>>;
  try {
    decoded = await decodeImage(file);
  } catch {
    if (file.size <= MAX_STANDARD_UPLOAD) return file;
    throw new Error("這張圖片無法在目前瀏覽器中壓縮，請改選較小的 JPEG 或 PNG 圖片。");
  }

  try {
    if (Math.max(decoded.width, decoded.height) <= MAX_DIMENSION && file.size <= MAX_STANDARD_UPLOAD) return file;
    const scale = Math.min(1, MAX_DIMENSION / Math.max(decoded.width, decoded.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(decoded.width * scale));
    canvas.height = Math.max(1, Math.round(decoded.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("無法處理圖片，請改選 JPEG 或 PNG 圖片。");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);

    for (const quality of [0.84, 0.72, 0.6]) {
      let blob = await waitForBlob(canvas, "image/webp", quality);
      if (!blob || blob.type !== "image/webp") blob = await waitForBlob(canvas, "image/jpeg", quality);
      if (!blob) continue;
      if (blob.size >= file.size) return file;
      if (blob.size > MAX_STANDARD_UPLOAD && quality !== 0.6) continue;
      if (blob.size > MAX_STANDARD_UPLOAD) throw new Error("壓縮後的圖片仍然過大，請換一張較小的圖片。");
      const extension = blob.type === "image/webp" ? "webp" : blob.type === "image/png" ? "png" : "jpg";
      const baseName = file.name.replace(/\.[^.]+$/, "") || "image";
      return new File([blob], `${baseName}.${extension}`, { type: blob.type, lastModified: file.lastModified });
    }

    if (file.size <= MAX_STANDARD_UPLOAD) return file;
    throw new Error("圖片處理失敗，請改選 JPEG 或 PNG 圖片後重試。");
  } finally {
    decoded.close();
  }
}
