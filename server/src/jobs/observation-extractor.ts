import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { CairnDatabase } from "../db/index.js";
import { threads, threadWorkspaces } from "../db/schema.js";
import type { LlmGateway } from "../llm/gateway.js";
import { getLlmModel } from "../llm/config.js";
import type { MapGateway } from "../maps/gateway.js";
import { checkCandidateFeasibility } from "../services/candidate-feasibility.js";
import { upsertInboxItem } from "../services/inbox.js";
import {
  findUnprocessedObservations,
  markObservationsProcessed,
  purgeOldPhoneBodies
} from "../services/observations.js";

const TIME_ZONE = process.env.CAIRN_TIME_ZONE ?? "Asia/Seoul";
const PHONE_BATCH = 40;
const SESSION_BATCH = 50;
// 홈처럼 범용 디렉터리는 thread 에 묶지 않는다.
const GENERIC_CWDS = new Set(["/", "/home/pi", "/tmp"]);

type Candidate = {
  obs: number[];
  title: string;
  start: string;
  end?: string | null;
  location?: string | null;
  confidence: number;
  reason: string;
};

const SYSTEM_PROMPT = `너는 휴대폰 알림이나 에이전트가 남긴 메모 목록에서 "사용자가 참석/수행해야 하는 구체적인 일정"만 골라내는 추출기다.
규칙:
- 날짜와 시각이 알림 텍스트에서 확인될 때만 후보로 만든다. 추측으로 시각을 만들지 마라.
- 광고, 단순 대화, 배송 상태, 결제 완료, 뉴스는 제외한다. 예약 확정, 약속 시간, 마감, 수령 예약은 포함한다.
- 상대 날짜("내일 7시")는 각 알림의 수신 시각 기준으로 절대 시각으로 바꾼다. 시간대는 ${TIME_ZONE}.
- 출력은 JSON 배열만. 후보가 없으면 [].
형식: [{"obs":[알림 id...],"title":"짧은 일정 제목","start":"ISO8601+09:00","end":"ISO8601+09:00 또는 null","location":"장소 또는 null","confidence":0~1,"reason":"근거 한 줄"}]`;

function stripFence(text: string): string {
  return text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
}

function parseCandidates(text: string, validIds: Set<number>): Candidate[] {
  let raw: unknown;
  try {
    raw = JSON.parse(stripFence(text));
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((c): Candidate[] => {
    if (!c || typeof c !== "object") return [];
    const o = c as Record<string, unknown>;
    const obs = Array.isArray(o.obs) ? o.obs.filter((n): n is number => typeof n === "number" && validIds.has(n)) : [];
    if (!obs.length || typeof o.title !== "string" || typeof o.start !== "string" || Number.isNaN(Date.parse(o.start))) {
      return [];
    }
    const end = typeof o.end === "string" && !Number.isNaN(Date.parse(o.end)) ? o.end : null;
    return [{
      obs,
      title: o.title.slice(0, 200),
      start: o.start,
      end,
      location: typeof o.location === "string" ? o.location.slice(0, 200) : null,
      confidence: typeof o.confidence === "number" ? Math.max(0, Math.min(1, o.confidence)) : 0.5,
      reason: typeof o.reason === "string" ? o.reason.slice(0, 300) : ""
    }];
  });
}

function label(iso: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: TIME_ZONE, month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false
  }).format(new Date(iso));
}

/** 폰 알림·에이전트 메모 → 일정 후보 질문. LLM 실패 시 관찰을 처리 완료로 표시하지 않아 다음 회차에 재시도된다. */
export async function extractPhoneCandidates(
  db: CairnDatabase,
  gateway: LlmGateway,
  nowIso: string,
  source: "phone_notification" | "agent" = "phone_notification",
  mapGateway?: MapGateway | undefined
): Promise<{ processed: number; candidates: number; error?: string }> {
  const rows = findUnprocessedObservations(db, source, PHONE_BATCH);
  if (!rows.length) return { processed: 0, candidates: 0 };

  const listing = rows
    .map((r) => `[${r.id}] (${r.occurredAt ?? r.receivedAt}) ${r.app ?? "?"} | ${r.title ?? ""} | ${(r.body ?? "").replace(/\s+/g, " ").slice(0, 400)}`)
    .join("\n");
  const result = await gateway.completeChat({
    model: getLlmModel(),
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `현재 시각: ${nowIso}\n알림:\n${listing}` }
    ],
    max_tokens: 1500
  });
  if (!result.ok) return { processed: 0, candidates: 0, error: result.error.message };

  const candidates = parseCandidates(result.data.choices[0]?.message.content ?? "", new Set(rows.map((r) => r.id)));
  for (const c of candidates) {
    // 과거 일정은 질문할 가치가 없다.
    if (Date.parse(c.end ?? c.start) < Date.parse(nowIso)) continue;
    const key = createHash("sha1").update(`${c.title}|${c.start}`).digest("hex").slice(0, 16);
    const where = c.location ? ` @ ${c.location}` : "";
    // 약속 제안이 오면 "그날 되는지"까지 붙여서 묻는다.
    const f = await checkCandidateFeasibility(db, mapGateway, {
      title: c.title, start: c.start, end: c.end ?? undefined, location: c.location ?? undefined, online: c.location ? undefined : true
    }, nowIso);
    const why = f.reasons.find((r) => !r.startsWith("온라인")) ?? "";
    upsertInboxItem(db, {
      kind: "event_candidate",
      dedupeKey: `candidate:${key}`,
      prompt: `${source === "agent" ? "대화 메모" : "알림"}에서 일정이 보여요: ${label(c.start)} '${c.title}'${where}. 판정: ${f.verdictKo}${why ? ` — ${why}` : ""} 일정에 넣을까요?`,
      payload: JSON.stringify({
        title: c.title, start: c.start, end: c.end, location: c.location, confidence: c.confidence, reason: c.reason,
        feasibility: { verdict: f.verdict, reasons: f.reasons, assumptions: f.assumptions }
      }),
      evidence: JSON.stringify(c.obs.map((id) => ({ observationId: id }))),
      priority: 50 + Math.round(c.confidence * 20),
      expiresAt: c.start
    });
  }
  markObservationsProcessed(db, rows.map((r) => r.id), nowIso);
  return { processed: rows.length, candidates: candidates.length };
}

/** 세션 관찰 → thread 에 안 묶인 작업 디렉터리면 "어느 thread 일인가요?" 질문. LLM 불필요. */
export function proposeWorkspaceLinks(db: CairnDatabase, nowIso: string): number {
  const rows = findUnprocessedObservations(db, "claude_session", SESSION_BATCH);
  if (!rows.length) return 0;
  const mapped = db.select().from(threadWorkspaces).all();
  const active = db.select({ id: threads.id, name: threads.name }).from(threads).where(eq(threads.status, "active")).all();
  let created = 0;
  const seen = new Set<string>();
  for (const r of rows) {
    const cwd = r.cwd?.replace(/\/+$/, "");
    if (!cwd || GENERIC_CWDS.has(cwd) || cwd.startsWith("/tmp/") || seen.has(cwd)) continue;
    if (mapped.some((m) => cwd === m.path || cwd.startsWith(`${m.path}/`))) continue;
    seen.add(cwd);
    upsertInboxItem(db, {
      kind: "thread_link",
      dedupeKey: `workspace:${cwd}`,
      prompt: `최근 '${cwd}'에서 작업하셨는데, 어느 thread(목적) 일인가요? 맞는 게 없으면 reject.`,
      payload: JSON.stringify({ cwd, candidates: active }),
      evidence: JSON.stringify([{ observationId: r.id }]),
      priority: 35
    });
    created += 1;
  }
  markObservationsProcessed(db, rows.map((r) => r.id), nowIso);
  return created;
}

export function startObservationExtractor(
  db: CairnDatabase,
  gateway: LlmGateway,
  opts: { intervalMs?: number; logError?: (e: unknown) => void; mapGateway?: MapGateway | undefined } = {}
): { stop: () => void } {
  const logError = opts.logError ?? ((e) => console.error("[extractor]", e));
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const nowIso = new Date().toISOString();
      proposeWorkspaceLinks(db, nowIso);
      for (const source of ["phone_notification", "agent"] as const) {
        const r = await extractPhoneCandidates(db, gateway, nowIso, source, opts.mapGateway);
        if (r.error) logError(new Error(`${source} extraction failed: ${r.error}`));
      }
      purgeOldPhoneBodies(db, nowIso);
    } catch (e) {
      logError(e);
    } finally {
      running = false;
    }
  };
  const handle = setInterval(() => void tick(), opts.intervalMs ?? 10 * 60_000);
  void tick();
  return { stop: () => clearInterval(handle) };
}
