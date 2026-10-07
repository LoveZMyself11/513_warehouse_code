import { defineConfig } from "vite";

export default defineConfig(({ command, isPreview }) => ({
  base: command === "serve" && !isPreview ? "/" : "/513base/",
}));
