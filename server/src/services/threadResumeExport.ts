import type {
  ThreadResumeData,
  ThreadResumeExportData,
  ThreadResumeExportFormat,
  ThreadResumeExportJson,
  ThreadRow
} from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import { findThreadById, findThreadResume } from "../repositories/threads.js";

export type ExportThreadResumeResult =
  | { status: "ok"; data: ThreadResumeExportData }
  | { status: "not_found" }
  | { status: "not_done" }
  | { status: "not_marked" }
  | { status: "empty" };

// Display-only normalization (cycle-57): trim, drop blanks, dedupe preserving
// first-seen order. Does NOT mutate stored skills_tags.
function normalizeSkills(skills: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of skills) {
    const s = raw.trim();
    if (s === "" || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function hasContent(resume: ThreadResumeData, skills: string[]): boolean {
  return (
    resume.starSituation != null ||
    resume.starAction != null ||
    resume.starResult != null ||
    skills.length > 0
  );
}

function buildWarnings(thread: ThreadRow): string[] {
  const warnings: string[] = [];
  // Cairn persists no STAR Task field; the goal is contextual only, never a
  // saved Task. State this so the artifact does not imply a Task was recorded.
  if (thread.goal != null && thread.goal.trim() !== "") {
    warnings.push(
      "Cairn에는 STAR의 Task 항목이 저장되지 않아 — 아래 목표는 맥락 참고용이고, 저장된 Task가 아니야."
    );
  }
  return warnings;
}

function buildJson(thread: ThreadRow, resume: ThreadResumeData, skills: string[]): ThreadResumeExportJson {
  return {
    thread: { id: thread.id, name: thread.name, kind: thread.kind, goal: thread.goal, deadline: thread.deadline },
    star: { situation: resume.starSituation, action: resume.starAction, result: resume.starResult },
    skills
  };
}

const MD_PLACEHOLDER = "_(작성되지 않음)_";

function mdField(value: string | null): string {
  return value != null && value.trim() !== "" ? value : MD_PLACEHOLDER;
}

function buildMarkdown(thread: ThreadRow, resume: ThreadResumeData, skills: string[], warnings: string[]): string {
  const lines: string[] = [];
  lines.push(`# ${thread.name}`);
  if (thread.kind != null && thread.kind.trim() !== "") lines.push(`종류: ${thread.kind}`);
  if (thread.goal != null && thread.goal.trim() !== "") lines.push(`목표: ${thread.goal}`);
  lines.push("");
  lines.push("## Situation");
  lines.push(mdField(resume.starSituation));
  lines.push("");
  lines.push("## Action");
  lines.push(mdField(resume.starAction));
  lines.push("");
  lines.push("## Result");
  lines.push(mdField(resume.starResult));
  lines.push("");
  lines.push("## Skills");
  if (skills.length > 0) for (const s of skills) lines.push(`- ${s}`);
  else lines.push(MD_PLACEHOLDER);
  if (warnings.length > 0) {
    lines.push("");
    lines.push("---");
    for (const w of warnings) lines.push(`> ${w}`);
  }
  return lines.join("\n");
}

// Pure deterministic formatter (cycle-57 FR-CV-02). Inputs are explicit value
// objects; output is snapshot-testable.
export function buildThreadResumeExport(
  thread: ThreadRow,
  resume: ThreadResumeData,
  format: ThreadResumeExportFormat
): ThreadResumeExportData {
  const skills = normalizeSkills(resume.skillsTags);
  const warnings = buildWarnings(thread);
  if (format === "json") {
    const json = buildJson(thread, resume, skills);
    return { format, content: JSON.stringify(json, null, 2), json, warnings };
  }
  return { format, content: buildMarkdown(thread, resume, skills, warnings), warnings };
}

// Read-only eligibility gate + export. Single source of truth for export rules;
// the frontend only mirrors visibility. No DB write, no LLM gateway.
export function exportThreadResume(
  db: CairnDatabase,
  id: number,
  format: ThreadResumeExportFormat
): ExportThreadResumeResult {
  const thread = findThreadById(db, id);
  if (!thread) return { status: "not_found" };
  if (thread.status !== "done") return { status: "not_done" };
  const resume = findThreadResume(db, id);
  if (!resume || resume.resumeRelevant !== true) return { status: "not_marked" };
  const skills = normalizeSkills(resume.skillsTags);
  if (!hasContent(resume, skills)) return { status: "empty" };
  return { status: "ok", data: buildThreadResumeExport(thread, resume, format) };
}
