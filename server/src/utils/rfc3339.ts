export function rfc3339ToMs(s: string): number {
  return Date.parse(s);
}

// Add n days to a YYYY-MM-DD date, returning YYYY-MM-DD. UTC math so calendar
// date comparisons stay deterministic regardless of server timezone.
export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + n));
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function addMinutesToRfc3339(rfc3339: string, minutes: number): string {
  const offsetMatch = rfc3339.match(/([+-]\d{2}:\d{2})$/);
  if (!offsetMatch) return rfc3339;
  const offsetStr = offsetMatch[1]!;
  const sign = offsetStr[0] === "+" ? 1 : -1;
  const parts = offsetStr.slice(1).split(":");
  const offsetMs = sign * (Number(parts[0]) * 60 + Number(parts[1])) * 60_000;

  const newEpochMs = Date.parse(rfc3339) + minutes * 60_000;
  const localMs = newEpochMs + offsetMs;
  const d = new Date(localMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}` +
    offsetStr
  );
}
