export function assetUrl(path: string): string {
  return path.startsWith("/data/")
    ? `${import.meta.env.BASE_URL}${path.slice(1)}`
    : path;
}
