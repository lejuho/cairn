import { naverTransitDirectionsUrl } from "@cairn/shared";
import type { EventRow } from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import type { MapGateway, TravelPoint } from "../maps/gateway.js";
import { normalizeLocation } from "../maps/normalize.js";
import { and, eq, gte, lte } from "drizzle-orm";
import { inboxItems, threads } from "../db/schema.js";
import { findPlannedAndConfirmedAll } from "../repositories/events.js";
import { findAllPeople } from "../repositories/people.js";
import { readNumericParam, readParam } from "../repositories/params.js";
import { findPinnedByPair } from "../repositories/pinned-transit-facts.js";
import { geocodeText } from "./geocoding.js";
import { upsertInboxItem } from "./inbox.js";

// "이 후보 일정을 넣으면 그날이 굴러가나?" — 저장 없는 가정 판정.
// 이동시간 근거 우선순위: 사용자가 고정한 소요시간(pinned) > Google 대중교통 추정(도착 시각 기준) > 모름.
// 네이버 경로 결과는 저장하지 않는다(cycle-77 원칙). 대신 "어떤 구간을 언제 기준으로 확인해야 판단이
// 서는지"를 analysisRequests 로 돌려주고, 확인은 에이전트/사용자가 실시간으로 한다.
//
// 스펙 원칙 4 (NOW 까지 거리가 검사 강도를 켠다):
//   imminent(≤7일)  이동·여유·겹침을 엄격하게 (겹침/늦음 = 어려움)
//   planning(≤60일) 이동은 계산하되 늦음은 빠듯으로, 마감·부하·동행자 연락 기한을 본다
//   distant(>60일)  겹침은 표시만, 이동은 계산하지 않고, 준비 사슬(역산)과 동행자를 본다
// "안 될 확률" 같은 숫자는 만들지 않는다 — 근거 있는 위험(risks)으로만 말한다 (원칙 6).
//
// 판정 자체는 일정을 저장하지 않는다. 단, 처음 등장한 사람의 프로필 질문(person_profile)은 inbox 에 만든다.

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
  // 같이 하는 사람 (Cairn people 이름, 부분 일치)
  people?: string[] | undefined;
  kind?: "meeting" | "trip" | "event" | "other" | undefined;
  abroad?: boolean | undefined;
};

export type Horizon = "imminent" | "planning" | "distant";
const IMMINENT_DAYS = 7;
const PLANNING_DAYS = 60;

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
  kind: "route_check" | "origin_check" | "location_check" | "person_profile" | "person_unknown" | "companion_check" | "prep_check";
  priority: "high" | "normal";
  reason: string;
  from?: string;
  to?: string;
  arriveBy?: string;
  naverUrl?: string | null;
  // 사용자가 확인한 소요시간을 cairn_pin_route 로 남기면 다음부터 이 요청이 사라진다.
  pinnable?: boolean;
  // person_profile: 사용자 답을 cairn_confirm 으로 기록할 inbox id
  inboxId?: number | undefined;
  // prep_check: 역산 기준일 (cairn_plan_prep 의 targetDate)
  targetDate?: string;
};

export type Risk = { type: "deadline" | "day_load" | "all_day" | "person" | "contact_deadline" | "conflict"; text: string };

export type PersonCheck = {
  id: number;
  name: string;
  contactBy: string | null;
  issues: string[];
};

export type CandidateFeasibility = {
  verdict: "possible" | "tight" | "hard" | "unknown";
  verdictKo: "가능" | "빠듯" | "어려움" | "확인 필요";
  horizon: Horizon;
  daysAhead: number;
  reasons: string[];
  risks: Risk[];
  people: PersonCheck[];
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
  const daysAhead = Math.floor((startMs - nowMs) / DAY_MS);
  const horizon: Horizon = daysAhead <= IMMINENT_DAYS ? "imminent" : daysAhead <= PLANNING_DAYS ? "planning" : "distant";
  const buffer = readNumericParam(db, "candidate_buffer_minutes", DEFAULT_BUFFER_MIN);
  const defaultOrigin = readParam(db, "default_origin")?.trim() || DEFAULT_ORIGIN;
  const online = input.online === true || (!input.location?.trim() && input.online !== false);
  // 여행·여러 날 일정은 시내 이동과 하루 부하 대신 기간 중 겹치는 일정만 본다.
  const multiDay = input.kind === "trip" || endMs - startMs >= 20 * 60 * MIN;

  const reasons: string[] = [];
  const assumptions: string[] = [];
  const risks: Risk[] = [];
  const analysisRequests: AnalysisRequest[] = [];
  // 각 근거가 판정을 어디까지 끌어내리는지. 최종 판정 = 가장 나쁜 것.
  const severities: CandidateFeasibility["verdict"][] = [];
  const bySeverity = (imminent: Sev, planning: Sev, distant: Sev): Sev =>
    horizon === "imminent" ? imminent : horizon === "planning" ? planning : distant;

  const dayStart = startMs - 18 * 60 * MIN;
  const dayEnd = endMs + 18 * 60 * MIN;
  const all = findPlannedAndConfirmedAll(db).filter((e) => e.start && e.end);
  const nearby = all.filter((e) => !isAllDay(e) && Date.parse(e.end!) > dayStart && Date.parse(e.start!) < dayEnd);
  const conflicts = nearby.filter((e) => Date.parse(e.start!) < endMs && Date.parse(e.end!) > startMs);
  const previous = nearby.filter((e) => Date.parse(e.end!) <= startMs && sameLocalDay(e.end!, input.start))
    .sort((x, y) => Date.parse(y.end!) - Date.parse(x.end!))[0] ?? null;
  const next = nearby.filter((e) => Date.parse(e.start!) >= endMs && sameLocalDay(e.start!, input.start))
    .sort((x, y) => Date.parse(x.start!) - Date.parse(y.start!))[0] ?? null;

  if (startMs < nowMs) {
    reasons.push("이미 시작 시각이 지났어요.");
    severities.push("hard");
  }
  for (const c of conflicts) {
    const text = `'${c.title}'(${dateLabel(Date.parse(c.start!))} ${hhmm(Date.parse(c.start!))}~${hhmm(Date.parse(c.end!))})과 시간이 겹쳐요.`;
    reasons.push(horizon === "distant" ? `${text} 아직 멀어서 조정 여지가 있어요.` : text);
    risks.push({ type: "conflict", text });
    severities.push(bySeverity("hard", "hard", "tight"));
  }

  // 종일 일정(여행·시험·행사 등)은 시간 겹침으로 안 잡히므로 따로 본다.
  for (const e of all.filter((x) => isAllDay(x) && Date.parse(x.start!) < endMs && Date.parse(x.end!) > startMs)) {
    const text = `그날 종일 일정 '${e.title}'이 있어요.`;
    reasons.push(text);
    risks.push({ type: "all_day", text });
    severities.push("tight");
  }

  // ── 이동 (distant 는 계산하지 않는다: 그때 출발지도 경로도 바뀐다) ──
  const legs: Leg[] = [];
  if (!online && multiDay) {
    reasons.push(`${input.location!.trim()} — 여러 날 일정이라 시내 이동 대신 기간 중 겹치는 일정만 봤어요.`);
  } else if (!online && horizon === "distant") {
    reasons.push(`${input.location!.trim()} — 이동은 날짜가 ${PLANNING_DAYS}일 이내로 가까워지면 다시 판정해요.`);
  } else if (!online) {
    const candidatePlace: PlaceRef = { label: input.location!.trim(), source: "candidate" };
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
      if (l.minutes == null) severities.push("unknown");
      else if (l.slackMinutes != null && l.slackMinutes < 0) severities.push(bySeverity("hard", "tight", "tight"));
      else if (l.slackMinutes != null && l.slackMinutes < TIGHT_SLACK_MIN) severities.push(bySeverity("tight", "possible", "possible"));
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
  } else if (!conflicts.length) {
    reasons.push("온라인이라 이동이 필요 없어요.");
  }

  // ── 프로젝트 부하: 근처 thread 마감, 그날 일정 총량 ──
  const date = localDate(startMs);
  const deadlines = db.select({ id: threads.id, name: threads.name, deadline: threads.deadline }).from(threads)
    .where(and(eq(threads.status, "active"), gte(threads.deadline, localDate(startMs - DAY_MS)), lte(threads.deadline, localDate(startMs + 3 * DAY_MS))))
    .all();
  for (const t of deadlines) {
    const d = t.deadline!.slice(0, 10);
    const diff = Math.round((Date.parse(d) - Date.parse(date)) / DAY_MS);
    const rel = diff === 0 ? "당일" : diff > 0 ? `${diff}일 전` : `${-diff}일 뒤`;
    const text = `'${t.name}' 마감(${d}) ${rel}이라 시간 내기 어려울 수 있어요.`;
    reasons.push(text);
    risks.push({ type: "deadline", text });
    severities.push(bySeverity("tight", "tight", "possible"));
  }
  const energyBudget = readNumericParam(db, "energy_budget", 8);
  const sameDay = all.filter((e) => !isAllDay(e) && sameLocalDay(e.start!, input.start));
  const loadHours = sameDay.reduce((h, e) => h + Math.max(0, Date.parse(e.end!) - Date.parse(e.start!)) / 3_600_000, 0)
    + (endMs - startMs) / 3_600_000;
  if (!multiDay && loadHours > energyBudget) {
    const text = `그날 일정이 이걸 포함해 ${loadHours.toFixed(1)}시간으로 체력 예산(${energyBudget}시간)을 넘어요.`;
    reasons.push(text);
    risks.push({ type: "day_load", text });
    severities.push(bySeverity("tight", "tight", "possible"));
  }

  // ── 동행자 ──
  const personChecks: PersonCheck[] = [];
  if (input.people?.length) {
    const directory = findAllPeople(db);
    const weekday = WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]!;
    const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, hour: "2-digit", hour12: false }).format(new Date(startMs)));
    const period = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
    for (const name of input.people) {
      const person = directory.find((p) => p.name === name) ?? directory.find((p) => p.name.includes(name) || name.includes(p.name.replace(/\(.*\)$/, "").trim()));
      if (!person) {
        analysisRequests.push({ kind: "person_unknown", priority: "normal", reason: `'${name}'은 Cairn 에 없는 사람이라 일정 조건을 반영하지 못했어요. 사용자에게 그 사람의 사정을 물어보세요.` });
        continue;
      }
      const issues: string[] = [];
      for (const c of person.hardConstraints ?? []) {
        if (c.type === "weekday_unavailable" && c.weekday === weekday) {
          issues.push(`${WEEKDAY_KO[weekday]}요일은 안 돼요 (${c.text}).`);
          severities.push(bySeverity("hard", "hard", "tight"));
        }
      }
      const pw = person.preferredWindows;
      if (pw && (!pw.weekdays.includes(weekday) || !pw.periods.includes(period))) {
        issues.push("선호하는 요일·시간대가 아니에요.");
      }
      let contactBy: string | null = null;
      if (person.leadTime) {
        const byMs = startMs - person.leadTime.days * DAY_MS;
        contactBy = localDate(byMs);
        if (byMs < nowMs) {
          issues.push(`보통 ${person.leadTime.days}일 전에는 말해야 하는데 이미 지났어요.`);
          severities.push("tight");
          risks.push({ type: "contact_deadline", text: `${person.name}: 연락 기한(${contactBy}) 지남` });
        } else {
          issues.push(`늦어도 ${contactBy}까지 연락해야 해요 (보통 ${person.leadTime.days}일 전).`);
        }
      } else {
        const dedupeKey = `person:${person.id}:profile`;
        upsertInboxItem(db, {
          kind: "person_profile",
          dedupeKey,
          prompt: `${person.name}님은 보통 며칠 전에 약속을 잡아야 하나요? 선호하는 요일·시간대나 안 되는 요일이 있나요?`,
          subjectType: "person",
          subjectId: person.id,
          priority: 40
        });
        analysisRequests.push({
          kind: "person_profile",
          priority: "normal",
          reason: `${person.name}님의 연락 기한·선호 시간을 몰라요. 대화 흐름에 맞으면 물어보고 cairn_confirm 으로 기록하세요.`,
          inboxId: findInboxId(db, dedupeKey)
        });
      }
      for (const i of issues) reasons.push(`${person.name}: ${i}`);
      if (issues.some((i) => i.includes("안 돼요") || i.includes("선호"))) risks.push({ type: "person", text: `${person.name}: ${issues.join(" ")}` });
      personChecks.push({ id: person.id, name: person.name, contactBy, issues });
    }
    if (input.kind === "trip") {
      analysisRequests.push({ kind: "companion_check", priority: horizon === "distant" ? "normal" : "high", reason: "동행자에게 그 날짜가 되는지 먼저 확인하세요. 확정 전에는 예약하지 않는 게 안전해요." });
    }
  }

  // ── 준비 사슬: Cairn 은 요건을 지어내지 않는다. 에이전트가 요건·소요 기간을 찾아 넘기면 역산해 watcher 로 등록 ──
  if (input.kind === "trip" || input.abroad) {
    analysisRequests.push({
      kind: "prep_check",
      priority: horizon === "imminent" ? "high" : "normal",
      reason: input.abroad
        ? "해외라면 여권 만료일(입국일 기준 6개월 이상 남았는지), 입국 요건(비자·전자여행허가), 항공·숙소 예약 시점을 확인하고, 각 준비의 소요 일수를 cairn_plan_prep 으로 넘기세요. Cairn 이 마지노선을 역산해 알림으로 등록해요."
        : "숙소·교통 예약 등 미리 해야 할 준비와 소요 일수를 사용자와 정리해 cairn_plan_prep 으로 넘기세요.",
      targetDate: date
    });
  }

  const order: CandidateFeasibility["verdict"][] = ["possible", "unknown", "tight", "hard"];
  const verdict = severities.reduce<CandidateFeasibility["verdict"]>((worst, s) => (order.indexOf(s) > order.indexOf(worst) ? s : worst), "possible");
  const ko = { possible: "가능", tight: "빠듯", hard: "어려움", unknown: "확인 필요" } as const;
  const priorityOrder = { high: 0, normal: 1 } as const;
  return {
    verdict,
    verdictKo: ko[verdict],
    horizon,
    daysAhead,
    reasons,
    risks,
    people: personChecks,
    assumptions,
    conflicts: conflicts.map((c) => ({ id: c.id, title: c.title, start: c.start, end: c.end })),
    previous: previous ? { id: previous.id, title: previous.title, end: previous.end, location: previous.location } : null,
    next: next ? { id: next.id, title: next.title, start: next.start, location: next.location } : null,
    legs,
    analysisRequests: analysisRequests.sort((x, y) => priorityOrder[x.priority] - priorityOrder[y.priority])
  };
}

type Sev = CandidateFeasibility["verdict"];
const DAY_MS = 86_400_000;
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
const WEEKDAY_KO: Record<string, string> = { sunday: "일", monday: "월", tuesday: "화", wednesday: "수", thursday: "목", friday: "금", saturday: "토" };

function localDate(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(new Date(ms));
}

function dateLabel(ms: number): string {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: TIME_ZONE, month: "numeric", day: "numeric" }).format(new Date(ms));
}

function findInboxId(db: CairnDatabase, dedupeKey: string): number | undefined {
  return db.select({ id: inboxItems.id }).from(inboxItems).where(eq(inboxItems.dedupeKey, dedupeKey)).get()?.id;
}

function sameLocalDay(a: string, b: string): boolean {
  return localDate(Date.parse(a)) === localDate(Date.parse(b));
}
