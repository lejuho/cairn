export function datetimeLocalToRfc3339(value: string): string {
  // getTimezoneOffset() returns minutes-west; KST=-540 → sign "+"
  const offsetMinutesWest = new Date().getTimezoneOffset();
  const sign = offsetMinutesWest <= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutesWest);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${value}:00${sign}${hh}:${mm}`;
}

export function localDateString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function localNowRfc3339(): string {
  const d = new Date();
  const offsetMinutesWest = d.getTimezoneOffset();
  const sign = offsetMinutesWest <= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutesWest);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${hh}:${mm}`;
}
