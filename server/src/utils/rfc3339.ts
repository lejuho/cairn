export function rfc3339ToMs(s: string): number {
  return Date.parse(s);
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
