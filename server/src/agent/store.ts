import { asc, desc, eq } from "drizzle-orm";
import type {
  AgentArtifact,
  AgentArtifactType,
  AgentConversationData,
  AgentConversationSummary,
  AgentMessage,
  AgentProvider
} from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import { agentArtifacts, agentConversations, agentMessages } from "../db/schema.js";
import { getNote, resolveTargets } from "../services/notes.js";

// Conversations with the in-app agent, kept so they survive closing the tab, plus the list of
// things each conversation created or changed ("artifacts").

export type ArtifactRef = { type: AgentArtifactType; id: number; label: string; action: string };

type StoredMessage =
  | { role: "user"; text: string }
  | { role: "agent"; text: string; steps: Extract<AgentMessage, { role: "agent" }>["steps"]; pending: Extract<AgentMessage, { role: "agent" }>["pending"]; via: string }
  | { role: "error"; text: string };

function summary(row: typeof agentConversations.$inferSelect): AgentConversationSummary {
  return { id: row.id, title: row.title, provider: row.provider as AgentProvider, model: row.model, updatedAt: row.updatedAt };
}

function toMessage(row: typeof agentMessages.$inferSelect): AgentMessage {
  const body = JSON.parse(row.content) as StoredMessage;
  return { id: row.id, createdAt: row.createdAt, ...body } as AgentMessage;
}

export function listConversations(db: CairnDatabase, limit = 50): AgentConversationSummary[] {
  return db.select().from(agentConversations).orderBy(desc(agentConversations.updatedAt)).limit(limit).all().map(summary);
}

export function findConversation(db: CairnDatabase, id: number): AgentConversationSummary | null {
  const row = db.select().from(agentConversations).where(eq(agentConversations.id, id)).get();
  return row ? summary(row) : null;
}

export function createConversation(db: CairnDatabase, firstText: string, provider: AgentProvider, model: string, nowIso: string): AgentConversationSummary {
  const title = firstText.replace(/\s+/g, " ").slice(0, 60);
  const [row] = db.insert(agentConversations).values({ title, provider, model, createdAt: nowIso, updatedAt: nowIso }).returning().all();
  return summary(row!);
}

export function listMessages(db: CairnDatabase, conversationId: number): AgentMessage[] {
  return db.select().from(agentMessages).where(eq(agentMessages.conversationId, conversationId)).orderBy(asc(agentMessages.id)).all().map(toMessage);
}

export function appendMessage(db: CairnDatabase, conversationId: number, body: StoredMessage, nowIso: string, touch?: { provider: AgentProvider; model: string }): AgentMessage {
  const [row] = db.insert(agentMessages).values({ conversationId, role: body.role, content: JSON.stringify(body), createdAt: nowIso }).returning().all();
  db.update(agentConversations).set({ updatedAt: nowIso, ...(touch ?? {}) }).where(eq(agentConversations.id, conversationId)).run();
  return toMessage(row!);
}

// Rewrites one stored agent message (a confirmation was answered).
export function updateAgentMessage(db: CairnDatabase, messageId: number, change: (m: Extract<StoredMessage, { role: "agent" }>) => void): AgentMessage | null {
  const row = db.select().from(agentMessages).where(eq(agentMessages.id, messageId)).get();
  if (!row) return null;
  const body = JSON.parse(row.content) as StoredMessage;
  if (body.role !== "agent") return null;
  change(body);
  db.update(agentMessages).set({ content: JSON.stringify(body) }).where(eq(agentMessages.id, messageId)).run();
  return toMessage({ ...row, content: JSON.stringify(body) });
}

export function recordArtifacts(db: CairnDatabase, conversationId: number, refs: ArtifactRef[], nowIso: string): void {
  for (const ref of refs) {
    db.insert(agentArtifacts)
      .values({ conversationId, targetType: ref.type, targetId: ref.id, label: ref.label.slice(0, 200), lastAction: ref.action, updatedAt: nowIso })
      .onConflictDoUpdate({
        target: [agentArtifacts.conversationId, agentArtifacts.targetType, agentArtifacts.targetId],
        set: { label: ref.label.slice(0, 200), lastAction: ref.action, updatedAt: nowIso }
      })
      .run();
  }
}

function linkOf(type: AgentArtifactType, id: number, when: string | null): string {
  if (type === "thread") return `/threads/${id}`;
  if (type === "note") return "/notes";
  if (type === "event" && when) return `/calendar?date=${when.slice(0, 10)}`;
  return `/notes?targetType=${type}&targetId=${id}`;
}

// The things a conversation touched, with their state read fresh so the list shows what they are now.
export function listArtifacts(db: CairnDatabase, conversationId: number): AgentArtifact[] {
  const rows = db.select().from(agentArtifacts).where(eq(agentArtifacts.conversationId, conversationId)).orderBy(desc(agentArtifacts.updatedAt)).all();
  const targets = resolveTargets(db, rows.filter((r) => r.targetType !== "note").map((r) => ({ targetType: r.targetType, targetId: r.targetId })));
  return rows.map((row) => {
    const type = row.targetType as AgentArtifactType;
    if (type === "note") {
      const note = getNote(db, row.targetId);
      const label = note ? (note.title ?? note.body?.split("\n")[0] ?? note.items[0]?.text ?? row.label) : row.label;
      return { targetType: type, targetId: row.targetId, label, when: note?.noteDate ?? null, status: note?.archivedAt ? "archived" : null, lastAction: row.lastAction, exists: note !== null, link: linkOf(type, row.targetId, null) };
    }
    const now = targets.get(`${type}:${row.targetId}`);
    return {
      targetType: type, targetId: row.targetId, label: now?.label ?? row.label, when: now?.when ?? null, status: now?.status ?? null,
      lastAction: row.lastAction, exists: now !== undefined, link: linkOf(type, row.targetId, now?.when ?? null)
    };
  });
}

export function getConversation(db: CairnDatabase, id: number): AgentConversationData | null {
  const conversation = findConversation(db, id);
  if (!conversation) return null;
  return { conversation, messages: listMessages(db, id), artifacts: listArtifacts(db, id) };
}

export function deleteConversation(db: CairnDatabase, id: number): boolean {
  if (!findConversation(db, id)) return false;
  db.transaction((tx) => {
    tx.delete(agentArtifacts).where(eq(agentArtifacts.conversationId, id)).run();
    tx.delete(agentMessages).where(eq(agentMessages.conversationId, id)).run();
    tx.delete(agentConversations).where(eq(agentConversations.id, id)).run();
  });
  return true;
}
