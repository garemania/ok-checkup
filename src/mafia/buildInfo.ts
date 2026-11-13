/** 빌드 시 주입되는 버전 정보 (vite.config.ts의 define). 테스트 등 주입이 없는 환경에서는 기본값 */
const version = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";
const commit = typeof __APP_COMMIT__ !== "undefined" ? __APP_COMMIT__ : "local";
const builtAt = typeof __APP_BUILD_TIME__ !== "undefined" ? __APP_BUILD_TIME__ : "";

/** 업데이트 시각을 한국 시간으로: "2026.11.13 11:20" */
export function formatKST(iso: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}.${get("month")}.${get("day")} ${get("hour")}:${get("minute")}`;
}

export const BUILD_INFO = {
  version: version === "dev" ? "dev" : `v${version}`,
  commit,
  updatedAt: formatKST(builtAt),
};

/** 화면 표시용 한 줄: "v1.23 · 업데이트 2026.11.13 11:20 (a1b2c3d)" */
export const BUILD_LABEL = `${BUILD_INFO.version} · 업데이트 ${BUILD_INFO.updatedAt} (${BUILD_INFO.commit})`;
