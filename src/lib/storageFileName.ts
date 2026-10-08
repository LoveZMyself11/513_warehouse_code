export const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

export function storageFileName(file: Pick<File, "type">): string {
  const extension = IMAGE_EXTENSIONS[file.type];
  if (!extension) throw new Error("不支持的图片格式。");
  const suffix = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  // Storage keys must use ASCII; item and original photo names can be Unicode.
  return `image_${Date.now()}_${suffix}.${extension}`;
}
