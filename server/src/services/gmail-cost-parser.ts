// Deterministic, high-precision extractor for Gmail cancellation/refund
// evidence. No LLM: pure regex + keyword-adjacency scoring. Precision over
// recall — when context is ambiguous we extract nothing so an unknown cost
// stays unknown rather than being filled with a wrong (e.g. purchase-total)
// value. See FR-SYNC-05 plan + advisor step-001 (strict keyword-adjacency).

export type GmailCostEvidence = {
  // Positive KRW integer, only when tied to cancellation/refund-fee context.
  cancelMoney?: number;
  // Normalized YYYY-MM-DD, only when tied to a refund/cancellation deadline.
  refundCutoff?: string;
};

// Keywords whose presence near an amount marks it as a cancellation/refund fee.
const CANCEL_FEE_KEYWORDS = ["취소수수료", "취소 수수료", "위약금", "환불수수료", "환불 수수료", "해지수수료", "해지 수수료"];
// Purchase/total keywords that disqualify a nearby amount (negative guard).
const PURCHASE_KEYWORDS = ["결제금액", "결제 금액", "결제하신", "상품금액", "상품 금액", "주문금액", "주문 금액", "총액", "총 결제", "합계", "정상가", "판매가"];
// Deadline indicators for refund-cutoff dates.
const DEADLINE_KEYWORDS = ["까지", "마감", "이전", "전까지"];
// Cancellation/refund context for refund-cutoff dates.
const REFUND_CONTEXT_KEYWORDS = ["취소", "환불", "해지"];

// Window (chars) within which a keyword must sit relative to the amount/date
// to count as adjacent. Tight on purpose: Korean fee phrases put the keyword
// immediately before the number (`취소 수수료 12,000원`).
const AMOUNT_WINDOW = 14;
const DATE_WINDOW = 16;

type Match = { value: number; start: number; end: number };

// Nearest distance from [start,end) to any keyword occurrence in text, or
// Infinity when none lies within `window`.
function nearestKeywordDistance(text: string, start: number, end: number, keywords: string[], window: number): number {
  let best = Infinity;
  for (const kw of keywords) {
    let from = 0;
    for (;;) {
      const idx = text.indexOf(kw, from);
      if (idx === -1) break;
      const kwEnd = idx + kw.length;
      // distance is gap between the keyword span and the token span (0 if adjacent/overlapping).
      const dist = idx >= end ? idx - end : start >= kwEnd ? start - kwEnd : 0;
      if (dist <= window && dist < best) best = dist;
      from = idx + 1;
    }
  }
  return best;
}

function findAmounts(text: string): Match[] {
  const out: Match[] = [];
  const re = /([0-9][0-9,]*)\s*원/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const digits = m[1]!.replace(/,/g, "");
    const value = Number.parseInt(digits, 10);
    if (Number.isNaN(value)) continue;
    out.push({ value, start: m.index, end: m.index + m[0].length });
  }
  return out;
}

function extractCancelMoney(text: string): number | undefined {
  const amounts = findAmounts(text);
  let bestValue: number | undefined;
  let bestDistance = Infinity;
  for (const a of amounts) {
    if (a.value <= 0) continue;
    const cancelDist = nearestKeywordDistance(text, a.start, a.end, CANCEL_FEE_KEYWORDS, AMOUNT_WINDOW);
    if (cancelDist === Infinity) continue;
    const purchaseDist = nearestKeywordDistance(text, a.start, a.end, PURCHASE_KEYWORDS, AMOUNT_WINDOW);
    // Reject when a purchase keyword is at least as close as the fee keyword.
    if (purchaseDist <= cancelDist) continue;
    // Pick the amount most tightly bound to cancellation context; earliest wins ties.
    if (cancelDist < bestDistance) {
      bestDistance = cancelDist;
      bestValue = a.value;
    }
  }
  return bestValue;
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function isValidYmd(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  const daysInMonth = [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d <= daysInMonth[m - 1]!;
}

// Year/month from the leading `YYYY-MM` of an RFC3339 / ISO start string.
function eventYearMonth(eventStartIso: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})/.exec(eventStartIso);
  if (!m) return null;
  return { year: Number.parseInt(m[1]!, 10), month: Number.parseInt(m[2]!, 10) };
}

// Infer the year for a month/day pulled from mail text that omitted the year.
// Use the event's year, but resolve the Dec↔Jan boundary explicitly so a
// refund cutoff written as `12월 28일` for a January event maps to the prior
// year and `1월 5일` for a December event maps to the next year.
function inferYear(eventStartIso: string, month: number): number | null {
  const ym = eventYearMonth(eventStartIso);
  if (!ym) return null;
  if (ym.month === 1 && month === 12) return ym.year - 1;
  if (ym.month === 12 && month === 1) return ym.year + 1;
  return ym.year;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

type DateMatch = { year: number | null; month: number; day: number; start: number; end: number };

function findDates(text: string): DateMatch[] {
  const out: DateMatch[] = [];
  // YYYY-MM-DD
  for (const m of text.matchAll(/(\d{4})-(\d{2})-(\d{2})/g)) {
    out.push({ year: Number.parseInt(m[1]!, 10), month: Number.parseInt(m[2]!, 10), day: Number.parseInt(m[3]!, 10), start: m.index!, end: m.index! + m[0].length });
  }
  // YYYY년 M월 D일
  for (const m of text.matchAll(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/g)) {
    out.push({ year: Number.parseInt(m[1]!, 10), month: Number.parseInt(m[2]!, 10), day: Number.parseInt(m[3]!, 10), start: m.index!, end: m.index! + m[0].length });
  }
  // M월 D일 (no year) — skip spans already covered by the year-bearing form.
  for (const m of text.matchAll(/(\d{1,2})월\s*(\d{1,2})일/g)) {
    const start = m.index!;
    const end = start + m[0].length;
    const covered = out.some((d) => start >= d.start && end <= d.end);
    if (covered) continue;
    out.push({ year: null, month: Number.parseInt(m[1]!, 10), day: Number.parseInt(m[2]!, 10), start, end });
  }
  return out;
}

function extractRefundCutoff(text: string, eventStartIso: string): string | undefined {
  const dates = findDates(text);
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const dm of dates) {
    const refundDist = nearestKeywordDistance(text, dm.start, dm.end, REFUND_CONTEXT_KEYWORDS, DATE_WINDOW);
    const deadlineDist = nearestKeywordDistance(text, dm.start, dm.end, DEADLINE_KEYWORDS, DATE_WINDOW);
    // Require BOTH a cancel/refund token and a deadline indicator nearby.
    if (refundDist === Infinity || deadlineDist === Infinity) continue;
    const year = dm.year ?? inferYear(eventStartIso, dm.month);
    if (year === null) continue;
    if (!isValidYmd(year, dm.month, dm.day)) continue;
    const distance = Math.min(refundDist, deadlineDist);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = `${year}-${pad2(dm.month)}-${pad2(dm.day)}`;
    }
  }
  return best;
}

export function extractGmailCostEvidence(text: string, eventStartIso: string): GmailCostEvidence {
  const evidence: GmailCostEvidence = {};
  const cancelMoney = extractCancelMoney(text);
  if (cancelMoney !== undefined) evidence.cancelMoney = cancelMoney;
  const refundCutoff = extractRefundCutoff(text, eventStartIso);
  if (refundCutoff !== undefined) evidence.refundCutoff = refundCutoff;
  return evidence;
}
