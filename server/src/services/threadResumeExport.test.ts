import { describe, expect, it } from "vitest";
import type { ThreadResumeData, ThreadRow } from "@cairn/shared";
import { ThreadResumeExportDataSchema } from "@cairn/shared";
import { buildThreadResumeExport } from "./threadResumeExport.js";

const THREAD: ThreadRow = {
  id: 7, name: "파리 여행", kind: "trip", goal: "6월 파리 완수",
  definitionOfDone: null, deadline: "2026-06-30", status: "done", createdAt: null
};
const RESUME: ThreadResumeData = {
  resumeRelevant: true, starSituation: "상황 텍스트", starAction: "행동 텍스트", starResult: "결과 텍스트",
  skillsTags: ["계획", "조율"]
};

describe("buildThreadResumeExport (cycle-57)", () => {
  it("builds deterministic JSON with structured json + content and a no-task warning", () => {
    const out = buildThreadResumeExport(THREAD, RESUME, "json");
    if (out.format !== "json") throw new Error("expected json format");
    expect(out.json).toEqual({
      thread: { id: 7, name: "파리 여행", kind: "trip", goal: "6월 파리 완수", deadline: "2026-06-30" },
      star: { situation: "상황 텍스트", action: "행동 텍스트", result: "결과 텍스트" },
      skills: ["계획", "조율"]
    });
    expect(out.content).toBe(JSON.stringify(out.json, null, 2));
    expect(out.warnings.some((w) => w.includes("Task"))).toBe(true);
    expect(ThreadResumeExportDataSchema.safeParse(out).success).toBe(true);
  });

  it("builds deterministic Markdown with all STAR sections and skills bullets", () => {
    const out = buildThreadResumeExport(THREAD, RESUME, "markdown");
    expect(out.format).toBe("markdown");
    expect("json" in out).toBe(false);
    expect(out.content).toContain("# 파리 여행");
    expect(out.content).toContain("## Situation\n상황 텍스트");
    expect(out.content).toContain("## Skills\n- 계획\n- 조율");
    expect(ThreadResumeExportDataSchema.safeParse(out).success).toBe(true);
  });

  it("renders placeholders for empty optional star fields without fabricating", () => {
    const out = buildThreadResumeExport(THREAD, { ...RESUME, starAction: null, starResult: null }, "markdown");
    expect(out.content).toContain("## Action\n_(작성되지 않음)_");
    expect(out.content).toContain("## Result\n_(작성되지 않음)_");
  });

  it("normalizes skills for display (trim, drop blanks, dedupe, preserve order) without mutating input", () => {
    const skills = ["  계획 ", "계획", "", "조율", "  "];
    const input = { ...RESUME, skillsTags: [...skills] };
    const out = buildThreadResumeExport(THREAD, input, "json");
    if (out.format !== "json") throw new Error("expected json format");
    expect(out.json.skills).toEqual(["계획", "조율"]);
    expect(input.skillsTags).toEqual(skills); // unchanged
  });

  it("omits the task warning when the thread has no goal", () => {
    const out = buildThreadResumeExport({ ...THREAD, goal: null }, RESUME, "markdown");
    expect(out.warnings).toEqual([]);
    expect(out.content).not.toContain("목표:");
  });

  it("preserves user Markdown characters literally (no HTML execution)", () => {
    const out = buildThreadResumeExport(THREAD, { ...RESUME, starSituation: "<b>x</b> & _y_ # z" }, "markdown");
    expect(out.content).toContain("<b>x</b> & _y_ # z");
  });
});
