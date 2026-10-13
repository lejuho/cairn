import { z } from "zod";

// Agent inbox (macro-obs events 패턴 + 질문 상태 관리).
// observations = 수동 관찰 원본(append-only), inbox_items = 사용자에게 던질 질문/알림.
// 질문 상태는 서버가 들고 있으므로 어느 에이전트에서 답해도 다른 곳에서 사라진다.

export const OBSERVATION_SOURCES = ["claude_session", "phone_notification", "agent"] as const;
export const ObservationSourceSchema = z.enum(OBSERVATION_SOURCES);

export const INBOX_KINDS = [
  "outcome_check", // 끝난 일정의 결과 확인
  "deadline", // 임박한 thread 마감
  "watcher_due", // 기한 도래 watcher
  "event_candidate", // 관찰에서 추출한 일정 후보
  "thread_link" // 관찰/일정을 thread 에 연결하자는 제안
] as const;
export const InboxKindSchema = z.enum(INBOX_KINDS);

export const INBOX_STATUSES = ["pending", "answered", "dismissed", "expired"] as const;
export const InboxStatusSchema = z.enum(INBOX_STATUSES);

export const INBOX_DECISIONS = ["accept", "reject", "dismiss", "snooze"] as const;
export const InboxDecisionSchema = z.enum(INBOX_DECISIONS);

export const CreateObservationRequestSchema = z
  .object({
    source: ObservationSourceSchema,
    // 중복 제거 키 (세션 id, 알림 key 등). 같은 source+ref 는 한 번만 저장.
    sourceRef: z.string().min(1).max(200).optional(),
    app: z.string().max(200).optional(),
    title: z.string().max(500).optional(),
    body: z.string().max(8000).optional(),
    cwd: z.string().max(500).optional(),
    occurredAt: z.string().datetime({ offset: true }).optional(),
    meta: z.record(z.unknown()).optional()
  })
  .strict();
export type CreateObservationRequest = z.infer<typeof CreateObservationRequestSchema>;

export const InboxQuerySchema = z.object({
  cwd: z.string().max(500).optional(),
  now: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional()
});

export const InboxAnswerRequestSchema = z
  .object({
    decision: InboxDecisionSchema,
    // outcome_check: { outcome: done|cancelled|moved|late }
    // event_candidate: 수락 시 일부 필드 덮어쓰기 { title, start, end, location }
    // thread_link: { threadId } 로 다른 thread 지정 가능
    value: z.record(z.unknown()).optional(),
    note: z.string().max(2000).optional(),
    snoozeHours: z.number().int().min(1).max(24 * 14).optional(),
    answeredBy: z.string().max(100).optional()
  })
  .strict();
export type InboxAnswerRequest = z.infer<typeof InboxAnswerRequestSchema>;

export const ThreadWorkspaceRequestSchema = z
  .object({
    threadId: z.number().int().positive(),
    path: z.string().min(1).max(500)
  })
  .strict();

export type InboxItemView = {
  id: number;
  kind: z.infer<typeof InboxKindSchema>;
  prompt: string;
  priority: number;
  relevance: "workspace" | "global";
  threadId: number | null;
  threadName: string | null;
  subject: { type: string; id: number } | null;
  payload: Record<string, unknown> | null;
  evidence: unknown[] | null;
  createdAt: string;
  // 이 항목에 허용되는 decision 과 value 힌트 — 에이전트가 그대로 따라 쓰면 된다.
  answerHint: string;
};

const iso = z.string().datetime({ offset: true });

export const CandidateFeasibilityRequestSchema = z
  .object({
    title: z.string().max(200).optional(),
    start: iso,
    end: iso.optional(),
    location: z.string().max(300).optional(),
    online: z.boolean().optional()
  })
  .strict();

// 에이전트가 메일·X·Luma·대화에서 찾은 일정을 구조화된 채로 제안 (자유 텍스트 재추출 손실 없음).
export const ProposeEventRequestSchema = CandidateFeasibilityRequestSchema.extend({
  title: z.string().min(1).max(200),
  url: z.string().url().max(1000).optional(),
  // 어디서 찾았는지 (gmail, x, luma, conversation ...)
  origin: z.string().max(50).optional(),
  note: z.string().max(1000).optional(),
  proposedBy: z.string().max(100).optional()
}).strict();
export type ProposeEventRequest = z.infer<typeof ProposeEventRequestSchema>;

// 사용자가 확인한 소요시간만 고정한다 (네이버 경로 상세는 저장하지 않음).
export const PinRouteRequestSchema = z
  .object({
    from: z.string().min(1).max(300),
    to: z.string().min(1).max(300),
    minutes: z.number().int().min(1).max(600),
    note: z.string().max(300).optional()
  })
  .strict();
