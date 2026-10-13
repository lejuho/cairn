import { naverTransitDirectionsUrl } from "@cairn/shared";
import type { EventRow } from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import type { MapGateway, TravelPoint } from "../maps/gateway.js";
import { normalizeLocation } from "../maps/normalize.js";
import { findPlannedAndConfirmedAll } from "../repositories/events.js";
import { readNumericParam, readParam } from "../repositories/params.js";
import { findPinnedByPair } from "../repositories/pinned-transit-facts.js";
import { geocodeText } from "./geocoding.js";

// "이 후보 일정을 넣으면 그날이 굴러가나?" — 저장 없는 가정 판정.
// 이동시간 근거 우선순위: 사용자가 고정한 소요시간(pinned) > Google 대중교통 추정(도착 시각 기준) > 모름.
// 네이버 경로 결과는 저장하지 않는다(cycle-77 원칙). 대신 "어떤 구간을 언제 기준으로 확인해야 판단이
// 서는지"를 analysisRequests 로 돌려주고, 확인은 에이전트/사용자가 실시간으로 한다.

const TIME_ZONE = process.env.CAIRN_TIME_ZONE ?? "Asia/Seoul";
export const DEFAULT_ORIGIN = "홍익대학교 서울캠퍼스";
const DEFAULT_BUFFER_MIN = 10;
const TIGHT_SLACK_MIN = 15;
const MIN = 60_000;

export type CandidateInput = {
  title?: string | undefined;
  start: string;
  end?: string | undefined;
  location?: string | undefined;
  online?: boolean | undefined;
};

type PlaceRef = { label: string; source: "previous_event" | "default_origin" | "candidate" | "next_event" };

export type Leg = {
  from: PlaceRef;
  to: PlaceRef;
  minutes: number | null;
  basis: "pinned" | "google_transit_estimate" | "unknown";
  // 이 구간에서 지켜야 하는 시각 (출발 기준이면 departBy, 다음 일정 기준이면 arriveBy).
  arriveBy: string;
  departBy: string | null;
  slackMinutes: number | null;
  naverUrl: string | null;
  note: string | null;
};

export type AnalysisRequest = {
  kind: "route_check" | "origin_check" | "location_check";
  priority: "high" | "normal";
  reason: string;
  from?: string;
  to?: string;
  arriveBy?: string;
  naverUrl?: string | null;
  // 사용자가 확인한 소요시간을 cairn_pin_route 로 남기면 다음부터 이 요청이 사라진다.
  pinnable?: boolean;
};

export type CandidateFeasibility = {
  verdict: "possible" | "tight" | "hard" | "unknown";
  verdictKo: "가능" | "빠듯" | "어려움" | "확인 필요";
  reasons: string[];
  assumptions: string[];
  conflicts: { id: number; title: string; start: string | null; end: string | null }[];
  previous: { id: number; title: string; end: string | null; location: string | null } | null;
  next: { id: number; title: string; start: string | null; location: string | null } | null;
  legs: Leg[];
  analysisRequests: AnalysisRequest[];
};

function hhmm(ms: number): string {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ms));
}

function isPhysical(e: EventRow): boolean {
  return !!e.location?.trim() && e.mode !== "remote" && e.mode !== "async";
}

function isAllDay(e: EventRow): boolean {
  if (!e.start || !e.end) return false;
  return Date.parse(e.end) - Date.parse(e.start) >= 86_400_000 && hhmm(Date.parse(e.start)) === "00:00";
}

async function travel(
  db: CairnDatabase,
  gateway: MapGateway | undefined,
  from: PlaceRef,
  to: PlaceRef,
  arriveByMs: number
): Promise<Omit<Leg, "departBy" | "slackMinutes">> {
  const base = { from, to, arriveBy: new Date(arriveByMs).toISOString(), note: null as string | null };
  const pinned = findPinnedByPair(db, normalizeLocation(from.label), normalizeLocation(to.label), "public_transit");
  let a: TravelPoint | null = null;
  let b: TravelPoint | null = null;
  if (gateway) {
    const [ga, gb] = await Promise.all([geocodeText(db, gateway, from.label), geocodeText(db, gateway, to.label)]);
    a = ga;
    b = gb;
  }
  const naverUrl = a && b ? naverTransitDirectionsUrl({ ...a, label: from.label }, { ...b, label: to.label }) : null;
  if (pinned?.active) {
    return { ...base, minutes: pinned.durationMinutes, basis: "pinned", naverUrl, note: pinned.note };
  }
  if (gateway && a && b) {
    const r = await gateway.travelTime(a, b, "transit", { arrivalTime: Math.floor(arriveByMs / 1000) });
    if (r.ok && r.outcome.status === "resolved") {
      return { ...base, minutes: Math.round(r.outcome.durationSeconds / 60), basis: "google_transit_estimate", naverUrl };
    }
  }
  return { ...base, minutes: null, basis: "unknown", naverUrl };
}

export async function checkCandidateFeasibility(
  db: CairnDatabase,
  gateway: MapGateway | undefined,
  input: CandidateInput,
  nowIso = new Date().toISOString()
): Promise<CandidateFeasibility> {
  const startMs = Date.parse(input.start);
  const endMs = input.end ? Date.parse(input.end) : startMs + 60 * MIN;
  const nowMs = Date.parse(nowIso);
  const buffer = readNumericParam(db, "candidate_buffer_minutes", DEFAULT_BUFFER_MIN);
  const defaultOrigin = readParam(db, "default_origin")?.trim() || DEFAULT_ORIGIN;
  const online = input.online === true || (!input.location?.trim() && input.online !== false);

  const reasons: string[] = [];
  const assumptions: string[] = [];
  const analysisRequests: AnalysisRequest[] = [];

  const dayStart = startMs - 18 * 60 * MIN;
  const dayEnd = endMs + 18 * 60 * MIN;
  const nearby = findPlannedAndConfirmedAll(db).filter((e) => {
    if (!e.start || !e.end || isAllDay(e)) return false;
    const s = Date.parse(e.start);
    const t = Date.parse(e.end);
    return t > dayStart && s < dayEnd;
  });
  const conflicts = nearby.filter((e) => Date.parse(e.start!) < endMs && Date.parse(e.end!) > startMs);
  const previous = nearby.filter((e) => Date.parse(e.end!) <= startMs && sameLocalDay(e.end!, input.start))
    .sort((x, y) => Date.parse(y.end!) - Date.parse(x.end!))[0] ?? null;
  const next = nearby.filter((e) => Date.parse(e.start!) >= endMs && sameLocalDay(e.start!, input.start))
    .sort((x, y) => Date.parse(x.start!) - Date.parse(y.start!))[0] ?? null;

  for (const c of conflicts) reasons.push(`'${c.title}'(${hhmm(Date.parse(c.start!))}~${hhmm(Date.parse(c.end!))})과 시간이 겹쳐요.`);
  if (startMs < nowMs) reasons.push("이미 시작 시각이 지났어요.");

  const legs: Leg[] = [];
  if (!online) {
    const candidatePlace: PlaceRef = { label: input.location!.trim(), source: "candidate" };
    // 출발지: 직전 대면 일정 장소, 없으면 기본 출발지(가정임을 명시).
    let origin: PlaceRef;
    // 출발을 제약하는 시각: 직전 일정 종료, 또는 오늘이면 지금. 둘 다 없으면 여유를 따지지 않는다.
    let originFreeFromMs: number | null;
    if (previous && isPhysical(previous)) {
      origin = { label: previous.location!.trim(), source: "previous_event" };
      originFreeFromMs = Date.parse(previous.end!);
    } else {
      origin = { label: defaultOrigin, source: "default_origin" };
      originFreeFromMs = previous ? Date.parse(previous.end!) : sameLocalDay(nowIso, input.start) ? nowMs : null;
      assumptions.push(`직전 대면 일정의 장소를 몰라서 기본 출발지(${defaultOrigin})에서 출발한다고 가정했어요.`);
      analysisRequests.push({
        kind: "origin_check",
        priority: "normal",
        reason: `그 시간 전에 어디 있을지 Cairn 은 몰라요. 기본 출발지(${defaultOrigin})가 아니면 출발지를 사용자에게 확인하세요.`
      });
    }

    const arriveMs = startMs - buffer * MIN;
    const leg = await travel(db, gateway, origin, candidatePlace, arriveMs);
    const departByMs = leg.minutes != null ? arriveMs - leg.minutes * MIN : null;
    const slack = departByMs != null && originFreeFromMs != null ? Math.floor((departByMs - originFreeFromMs) / MIN) : null;
    legs.push({ ...leg, departBy: departByMs != null ? new Date(departByMs).toISOString() : null, slackMinutes: slack });

    if (leg.minutes == null) {
      reasons.push(`'${origin.label}' → '${candidatePlace.label}' 이동시간을 계산하지 못했어요.`);
    } else {
      reasons.push(`'${origin.label}'에서 ${leg.minutes}분${leg.basis === "pinned" ? "(고정값)" : "(추정)"}, ${hhmm(departByMs!)}까지 출발해야 ${buffer}분 여유 두고 도착해요.`);
      if (slack != null && slack < 0) reasons.push(`출발 가능 시각보다 ${-slack}분 늦어요.`);
    }

    if (next && isPhysical(next)) {
      const nextArrive = Date.parse(next.start!);
      const back = await travel(db, gateway, candidatePlace, { label: next.location!.trim(), source: "next_event" }, nextArrive - buffer * MIN);
      const backDepart = back.minutes != null ? nextArrive - buffer * MIN - back.minutes * MIN : null;
      const backSlack = backDepart != null ? Math.floor((backDepart - endMs) / MIN) : null;
      legs.push({ ...back, departBy: backDepart != null ? new Date(backDepart).toISOString() : null, slackMinutes: backSlack });
      if (back.minutes != null) {
        reasons.push(`끝나고 '${next.title}'까지 ${back.minutes}분${back.basis === "pinned" ? "(고정값)" : "(추정)"} — ${backSlack! >= 0 ? `${backSlack}분 여유` : `${-backSlack!}분 부족`}.`);
      }
    }

    for (const l of legs) {
      if (l.basis === "pinned") continue;
      const tight = l.minutes == null || (l.slackMinutes != null && l.slackMinutes < TIGHT_SLACK_MIN);
      analysisRequests.push({
        kind: "route_check",
        priority: tight ? "high" : "normal",
        reason: l.minutes == null
          ? "이동시간을 모르면 판정할 수 없어요. 네이버 지도에서 이 구간을 확인해 사용자에게 전하세요."
          : tight
            ? `여유가 ${l.slackMinutes}분뿐이라 Google 추정만으로는 부족해요. 환승·배차를 네이버 지도로 확인한 뒤 전하세요.`
            : "Google 추정치예요. 사용자에게 경로를 안내할 때 네이버 지도로 실제 경로를 확인하세요.",
        from: l.from.label,
        to: l.to.label,
        arriveBy: l.arriveBy,
        naverUrl: l.naverUrl,
        pinnable: true
      });
    }
  }

  let verdict: CandidateFeasibility["verdict"];
  if (conflicts.length || startMs < nowMs || legs.some((l) => l.slackMinutes != null && l.slackMinutes < 0)) verdict = "hard";
  else if (legs.some((l) => l.minutes == null)) verdict = "unknown";
  else if (legs.some((l) => l.slackMinutes != null && l.slackMinutes < TIGHT_SLACK_MIN)) verdict = "tight";
  else verdict = "possible";
  if (online && !conflicts.length) reasons.push("온라인이라 이동이 필요 없어요.");

  const ko = { possible: "가능", tight: "빠듯", hard: "어려움", unknown: "확인 필요" } as const;
  return {
    verdict,
    verdictKo: ko[verdict],
    reasons,
    assumptions,
    conflicts: conflicts.map((c) => ({ id: c.id, title: c.title, start: c.start, end: c.end })),
    previous: previous ? { id: previous.id, title: previous.title, end: previous.end, location: previous.location } : null,
    next: next ? { id: next.id, title: next.title, start: next.start, location: next.location } : null,
    legs,
    analysisRequests: analysisRequests.sort((x, y) => (x.priority === y.priority ? 0 : x.priority === "high" ? -1 : 1))
  };
}

function sameLocalDay(a: string, b: string): boolean {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE });
  return f.format(new Date(a)) === f.format(new Date(b));
}
