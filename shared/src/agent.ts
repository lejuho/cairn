import { z } from "zod";

// 앱 안의 에이전트 패널. 사용자가 프로바이더와 모델을 고르고 말하면, 서버가 그 모델에게
// 정해진 도구 목록만 주고 호출한다. 추가·연결은 바로 반영하고, 지우거나 취소하는 일은
// 사용자가 확인해야 실행된다.

export const AGENT_PROVIDERS = ["anthropic", "openai", "xai"] as const;
export const AgentProviderSchema = z.enum(AGENT_PROVIDERS);
export type AgentProvider = z.infer<typeof AgentProviderSchema>;

export const AgentChatRequestSchema = z
  .object({
    provider: AgentProviderSchema,
    // 빈 문자열이면 그 프로바이더의 기본 모델.
    model: z.string().max(100).default(""),
    // 이어갈 대화. 없으면 새 대화를 만든다. 지난 대화 내용은 서버가 저장해 둔 것을 쓴다.
    conversationId: z.number().int().positive().optional(),
    text: z.string().trim().min(1).max(4000),
    // false(기본)면 'AI 공개'를 켠 메모만 읽는다. true 면 비공개 메모까지 읽고 고칠 수 있다.
    includePrivate: z.boolean().default(false),
    // true 면 이 대화에서 Gmail 을 검색하고 읽을 수 있다 (읽기 전용). 메일 내용이 프로바이더로 전송된다.
    includeMail: z.boolean().default(false),
    // false 면 등록한 시트가 있어도 이 대화에서는 읽지 않는다.
    includeSheets: z.boolean().default(true),
    // true 면 메모에 붙은 파일의 내용(글·PDF)을 읽을 수 있다. 꺼져 있어도 파일 이름은 보인다.
    includeFiles: z.boolean().default(false),
    // 이 말과 함께 채팅에 올린 파일 (POST /api/agent/uploads 가 준 fileId). 에이전트가 메모에 붙인다.
    uploads: z.array(z.number().int().positive()).max(10).default([])
  })
  .strict();
export type AgentChatRequest = z.infer<typeof AgentChatRequestSchema>;

export const AgentConfirmRequestSchema = z.object({ id: z.string().min(1).max(100), approve: z.boolean() }).strict();

export type AgentProviderInfo = {
  id: AgentProvider;
  label: string;
  // 이 서버에서 지금 쓸 수 있는가 (CLI 가 설치돼 있거나 프록시가 연결돼 있는가).
  available: boolean;
  // 어떻게 호출하는지 한 줄 (예: "claude CLI (구독)").
  via: string;
  models: Array<{ id: string; label: string }>;
  defaultModel: string;
  // 목록에 없는 모델 이름을 직접 적을 수 있는가.
  allowCustomModel: boolean;
};

// 에이전트가 한 일 하나. ok=false 면 실패했고 summary 가 이유다.
export type AgentStep = { tool: string; summary: string; ok: boolean; link?: string };

// 확인을 기다리는 일 (지우기·취소·드롭·연결 끊기, 그리고 메모·일정·할 일 고치기).
// detail 은 무엇이 어떻게 바뀌는지 여러 줄로 보여주는 글이다.
export type AgentPending = { id: string; tool: string; summary: string; detail?: string };

// 저장되는 메시지. 화면에 보인 그대로다.
export type AgentPendingState = AgentPending & { state: "waiting" | "done" };
export type AgentMessage =
  | { id: number; role: "user"; text: string; createdAt: string }
  | { id: number; role: "agent"; text: string; steps: AgentStep[]; pending: AgentPendingState[]; via: string; createdAt: string }
  | { id: number; role: "error"; text: string; createdAt: string };

export const AGENT_ARTIFACT_TYPES = ["event", "task", "thread", "note"] as const;
export type AgentArtifactType = (typeof AGENT_ARTIFACT_TYPES)[number];

// 대화에서 만들거나 고친 것 하나. label·when·status 는 지금 상태를 다시 읽은 값이다.
export type AgentArtifact = {
  targetType: AgentArtifactType;
  targetId: number;
  label: string;
  when: string | null;
  status: string | null;
  // 마지막으로 한 일 (예: "생성", "시간 변경", "드롭").
  lastAction: string;
  exists: boolean;
  link: string;
};

export type AgentConversationSummary = { id: number; title: string; provider: AgentProvider; model: string; updatedAt: string };

export type AgentConversationData = { conversation: AgentConversationSummary; messages: AgentMessage[]; artifacts: AgentArtifact[] };

// 한 번의 응답. conversationId 로 이어서 말한다.
export type AgentChatData = {
  conversationId: number;
  message: Extract<AgentMessage, { role: "agent" }>;
  artifacts: AgentArtifact[];
  // 데이터가 바뀌었으면 true — 화면이 다시 불러와야 한다.
  changed: boolean;
};

// 답을 만드는 동안 흘려보내는 진행 상황 (text/event-stream).
export type AgentStreamEvent =
  | { type: "status"; text: string }
  | { type: "step"; step: AgentStep }
  | { type: "say"; text: string }
  | { type: "done"; data: AgentChatData }
  | { type: "error"; message: string };

// 에이전트가 읽을 수 있는 바깥 출처의 상태.
export type AgentSources = {
  mail: {
    // 서버에 구글 OAuth 클라이언트가 있는가.
    configured: boolean;
    // 사용자가 메일 읽기를 승인해 토큰이 있는가.
    connected: boolean;
  };
  sheets: {
    // 구글 승인에 시트 읽기 권한이 들어 있는가.
    connected: boolean;
    list: AgentSheet[];
  };
  reason: {
    available: boolean;
    // 다른 에이전트가 보낼 때 쓰는 이름 (예: "cairn").
    session: string;
    unread: number;
  };
  // 사용자의 결정을 기다리는 일정 후보 수.
  candidates: number;
};

// 에이전트가 읽어도 된다고 사용자가 등록한 스프레드시트.
export type AgentSheet = { id: number; name: string; url: string };

export const AgentSheetAddRequestSchema = z.object({ url: z.string().trim().min(1).max(500), name: z.string().trim().max(80).optional() }).strict();

export const AgentMailConnectRequestSchema = z.object({ code: z.string().trim().min(1).max(4000) }).strict();

// 채팅에 올려 아직 어느 메모에도 붙지 않은 파일.
export type AgentUpload = { fileId: number; name: string; mime: string; size: number };
