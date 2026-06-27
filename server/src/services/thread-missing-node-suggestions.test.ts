import { describe, expect, it } from "vitest";
import type { ThreadRow } from "@cairn/shared";
import { computeThreadMissingNodeSuggestions, type NodeTitleInput } from "./thread-missing-node-suggestions.js";

function thread(id: number, opts: Partial<ThreadRow> = {}): ThreadRow {
  return { id, name: `T${id}`, kind: "trip", goal: null, definitionOfDone: null, deadline: null, status: "active", domain: "personal", createdAt: null, ...opts };
}
function node(threadId: number, title: string | null, status = "done"): NodeTitleInput {
  return { threadId, title, status };
}

const CURRENT = thread(1, { kind: "trip", status: "active" });

describe("computeThreadMissingNodeSuggestions (cycle-54)", () => {
  it("returns [] when current kind is empty/null or status is done/dropped", () => {
    expect(computeThreadMissingNodeSuggestions(thread(1, { kind: null }), [], [], [thread(2, { status: "done" })], [node(2, "비자")], [])).toEqual([]);
    expect(computeThreadMissingNodeSuggestions(thread(1, { kind: "  " }), [], [], [], [], [])).toEqual([]);
    expect(computeThreadMissingNodeSuggestions(thread(1, { kind: "trip", status: "done" }), [], [], [thread(2, { status: "done" })], [node(2, "비자")], [])).toEqual([]);
    expect(computeThreadMissingNodeSuggestions(thread(1, { kind: "trip", status: "dropped" }), [], [], [thread(2, { status: "done" })], [node(2, "비자")], [])).toEqual([]);
  });

  it("suggests soft/inferred node titles from same-kind completed thread done nodes", () => {
    const ev = [thread(2, { name: "지난 여행", status: "done" })];
    const out = computeThreadMissingNodeSuggestions(CURRENT, [], [], ev, [node(2, "비자 신청")], [node(2, "짐 싸기")]);
    expect(out).toHaveLength(2);
    const visa = out.find((s) => s.title === "비자 신청")!;
    expect(visa).toMatchObject({ nodeKind: "event", firmness: "soft", source: "inferred", evidenceThreadCount: 1, evidenceNodeCount: 1, id: "missing-node:event:비자 신청" });
    expect(visa.sampleThreads).toEqual([{ id: 2, name: "지난 여행" }]);
    expect(visa.reasonCodes).toEqual(["missing_same_kind_completed_thread", "missing_absent_from_current_thread"]);
    const pack = out.find((s) => s.title === "짐 싸기")!;
    expect(pack.nodeKind).toBe("task");
  });

  it("suppresses a suggestion when the current thread already has the normalized title (across kinds)", () => {
    const ev = [thread(2, { status: "done" })];
    // current has a TASK "비자 신청"; the historical EVENT "  비자  신청 " normalizes equal → suppressed
    const out = computeThreadMissingNodeSuggestions(CURRENT, [], [{ title: "비자 신청" }], ev, [node(2, "  비자  신청 ")], []);
    expect(out).toEqual([]);
  });

  it("excludes different-kind, non-done historical threads, and non-done historical nodes", () => {
    const ev = [thread(2, { status: "done", kind: "trip" })];
    const out = computeThreadMissingNodeSuggestions(
      CURRENT, [], [],
      ev,
      [node(2, "끝난 일", "done"), node(2, "안 끝난 일", "planned"), node(2, "취소된 일", "cancelled")],
      [node(2, "todo 작업", "todo")]
    );
    expect(out.map((s) => s.title)).toEqual(["끝난 일"]); // only the done event
  });

  it("collapses duplicate titles within one historical thread (counted once)", () => {
    const ev = [thread(2, { status: "done" })];
    const out = computeThreadMissingNodeSuggestions(CURRENT, [], [], ev, [node(2, "비자"), node(2, "비자"), node(2, "비자")], []);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ evidenceThreadCount: 1, evidenceNodeCount: 1 });
  });

  it("aggregates across threads and adds repeated-evidence reason at >=2 threads", () => {
    const ev = [thread(2, { name: "A", status: "done" }), thread(3, { name: "B", status: "done" }), thread(4, { name: "C", status: "done" })];
    const out = computeThreadMissingNodeSuggestions(
      CURRENT, [], [], ev,
      [node(2, "비자"), node(3, "비자"), node(4, "비자")],
      []
    );
    expect(out[0]).toMatchObject({ title: "비자", evidenceThreadCount: 3, evidenceNodeCount: 3 });
    expect(out[0]!.reasonCodes).toContain("missing_repeated_evidence");
    expect(out[0]!.sampleThreads).toHaveLength(3); // capped at 3
    expect(out[0]!.sampleThreads.map((t) => t.id)).toEqual([2, 3, 4]);
  });

  it("sorts by evidence count desc then title asc, and limits to 5", () => {
    const ev = [thread(2, { status: "done" }), thread(3, { status: "done" })];
    // "popular" in 2 threads; others in 1 each. expect popular first, rest title-asc.
    const out = computeThreadMissingNodeSuggestions(
      CURRENT, [], [], ev,
      [node(2, "popular"), node(3, "popular"), node(2, "a"), node(2, "b"), node(2, "c"), node(2, "d"), node(2, "e")],
      []
    );
    expect(out).toHaveLength(5);
    expect(out[0]!.title).toBe("popular");
    expect(out.slice(1).map((s) => s.title)).toEqual(["a", "b", "c", "d"]); // e dropped by limit
  });

  it("ignores blank historical titles", () => {
    const ev = [thread(2, { status: "done" })];
    const out = computeThreadMissingNodeSuggestions(CURRENT, [], [], ev, [node(2, "   "), node(2, null), node(2, "진짜")], []);
    expect(out.map((s) => s.title)).toEqual(["진짜"]);
  });

  it("carries no suggested date/order/score fields (only the contract keys)", () => {
    const ev = [thread(2, { status: "done" })];
    const out = computeThreadMissingNodeSuggestions(CURRENT, [], [], ev, [node(2, "비자")], []);
    expect(Object.keys(out[0]!).sort()).toEqual(
      ["evidenceNodeCount", "evidenceThreadCount", "firmness", "id", "nodeKind", "reasonCodes", "sampleThreads", "source", "title"].sort()
    );
  });
});
