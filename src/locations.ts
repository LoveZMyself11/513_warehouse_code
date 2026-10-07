export interface LocationOption {
  code: string;
  label: string;
  group: string;
  kind: "shelf" | "area";
}

const shelfLocations = ["A", "B", "C", "D"].flatMap((shelf) => [
  ...[1, 2, 3, 4].map((level) => ({
    code: `${shelf}${level}`,
    label: `${shelf} 货架 · 第 ${level} 层`,
    group: `${shelf} 货架`,
    kind: "shelf" as const,
  })),
]);

export const locations: LocationOption[] = [
  ...shelfLocations,
  { code: "FLOOR", label: "地板区域", group: "其他区域", kind: "area" },
  { code: "DOOR", label: "门后区域", group: "其他区域", kind: "area" },
  { code: "PENDING_A", label: "待分层 · A 货架", group: "待确认", kind: "area" },
  { code: "PENDING_B", label: "待分层 · B 货架", group: "待确认", kind: "area" },
  { code: "PENDING_C", label: "待分层 · C 货架", group: "待确认", kind: "area" },
  { code: "PENDING_D", label: "待分层 · D 货架", group: "待确认", kind: "area" },
];

export const locationLabel = (code: string) =>
  locations.find((location) => location.code === code)?.label ?? code;

export const normalizeLocation = (code: string) =>
  /^[A-D]\?$/.test(code) ? `PENDING_${code[0]}` : code;

export function parseLocationQr(payload: string): string | null {
  const match = /^513-warehouse:([A-D][1-4]|FLOOR|DOOR)$/.exec(payload.trim());
  return match?.[1] ?? null;
}
