const FALLBACK = "만남 기록 없음";

/**
 * Localized last-met label. Includes hour/minute so multiple same-day
 * relationship records stay distinguishable. Null/malformed input keeps the
 * explicit fallback — never inferred.
 */
export function formatLastMet(lastMet: string | null): string {
  if (!lastMet) return FALLBACK;
  const ms = Date.parse(lastMet);
  if (!Number.isFinite(ms)) return FALLBACK;
  return new Date(ms).toLocaleString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const LAST_MET_FALLBACK = FALLBACK;
