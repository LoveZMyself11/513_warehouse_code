import assert from "node:assert/strict";
import test from "node:test";
import { IMAGE_EXTENSIONS, storageFileName } from "../src/lib/storageFileName.ts";

test("Chinese photo names produce ASCII Storage keys for every supported image type", () => {
  for (const [type, extension] of Object.entries(IMAGE_EXTENSIONS)) {
    const file = new File(["photo"], "燕尾夹 · 清点照片.jpg", { type });
    const name = storageFileName(file);
    assert.match(name, new RegExp(`^image_[0-9]+_[0-9a-f]{32}\\.${extension}$`));
    assert.match(`inventory/user-id/${name}`, /^[a-zA-Z0-9_./-]+$/);
  }
});

test("repeated photo names have distinct Storage keys without requiring randomUUID", () => {
  const file = new File(["photo"], "1.jpg", { type: "image/jpeg" });
  const names = new Set(Array.from({ length: 100 }, () => storageFileName(file)));
  assert.equal(names.size, 100);
  assert.throws(() => storageFileName({ type: "text/plain" }), /图片格式/);
});
