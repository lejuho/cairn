import { describe, expect, it } from "vitest";
import type { EventRow, TaskRow, ThreadNodeLink } from "@cairn/shared";
import { computeThreadUnknownBlockers } from "./thread-unknown-blockers.js";

function ev(id: number, opts: Partial<EventRow> = {}): EventRow {
  return {
    id, threadId: 1, title: `E${id}`, type: null, start: null, end: null,
    location: null, mode: null, source: "cairn", selfImposed: 1, status: "planned",
    createdAt: null, updatedAt: null, ...opts
  };
}
function tk(id: number, opts: Partial<TaskRow> = {}): TaskRow {
  return { id, threadId: 1, title: `T${id}`, estMinutes: null, due: null, context: null, status: "todo", optional: 0, createdAt: null, ...opts };
}
function link(id: number, kind: ThreadNodeLink["kind"], from: ThreadNodeLink["from"], to: ThreadNodeLink["to"], firmness: ThreadNodeLink["firmness"] = "soft", source: ThreadNodeLink["source"] = "inferred"): ThreadNodeLink {
  return { id, kind, firmness, source, from, to };
}
const eref = (id: number, title: string) => ({ kind: "event" as const, id, title });
const tref = (id: number, title: string) => ({ kind: "task" as const, id, title });

describe("computeThreadUnknownBlockers (cycle-52)", () => {
  it("event requires task: missing prerequisite task estMinutes blocks a scheduled event → one blocker", () => {
    // event 1 (start set) requires task 2 (estMinutes null). requires → prereq=to(task2), blocked=from(event1).
    const events = [ev(1, { start: "2026-06-20T10:00:00+09:00" })];
    const tasks = [tk(2)];
    const links = [link(5, "requires", eref(1, "발표"), tref(2, "슬라이드"))];
    const out = computeThreadUnknownBlockers(events, tasks, links);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: "link:5:task.estMinutes", linkId: 5, linkKind: "requires",
      prerequisite: tref(2, "슬라이드"), blockedNode: eref(1, "발표"),
      missingField: "task.estMinutes", blockedField: "event.start"
    });
    expect(out[0]!.reasonCodes).toEqual(["blocker_missing_duration", "blocker_soft_link"]);
    expect(out[0]!.message).toContain("슬라이드");
    expect(out[0]!.message).toContain("발표");
  });

  it("task requires event: prerequisite event missing start AND end with blocked task due → two blockers", () => {
    // task 1 (due set) requires event 2 (start+end null). requires → prereq=event2, blocked=task1.
    const events = [ev(2)];
    const tasks = [tk(1, { due: "2026-06-25" })];
    const links = [link(7, "requires", tref(1, "제출"), eref(2, "리뷰 미팅"))];
    const out = computeThreadUnknownBlockers(events, tasks, links);
    expect(out.map((b) => b.missingField)).toEqual(["event.start", "event.end"]);
    expect(out.every((b) => b.blockedField === "task.due")).toBe(true);
    expect(out.every((b) => b.prerequisite.id === 2 && b.blockedNode.id === 1)).toBe(true);
    expect(out[0]!.id).toBe("link:7:event.start");
    expect(out[1]!.id).toBe("link:7:event.end");
  });

  it("event blocks task: prerequisite event missing fields blocks a due task", () => {
    // event 1 blocks task 2 (due set). blocks → prereq=from(event1), blocked=to(task2).
    const events = [ev(1, { start: "2026-06-20T10:00:00+09:00" })]; // end null
    const tasks = [tk(2, { due: "2026-06-25" })];
    const links = [link(9, "blocks", eref(1, "준비"), tref(2, "제출"), "hard", "authored")];
    const out = computeThreadUnknownBlockers(events, tasks, links);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ missingField: "event.end", blockedField: "task.due", prerequisite: eref(1, "준비"), blockedNode: tref(2, "제출") });
    // hard link → no soft-link reason code
    expect(out[0]!.reasonCodes).toEqual(["blocker_missing_end"]);
  });

  it("emits no blocker when the blocked node has no start/due target", () => {
    // blocked event has no start (only end) and task has no due → no reverse target.
    const events = [ev(1, { end: "2026-06-20T11:00:00+09:00" })];
    const tasks = [tk(2)];
    const links = [link(5, "requires", eref(1, "발표"), tref(2, "슬라이드"))];
    expect(computeThreadUnknownBlockers(events, tasks, links)).toEqual([]);
  });

  it("emits no blocker when the prerequisite is fully specified", () => {
    const events = [ev(1, { start: "2026-06-20T10:00:00+09:00" })];
    const tasks = [tk(2, { estMinutes: 30 })];
    const links = [link(5, "requires", eref(1, "발표"), tref(2, "슬라이드"))];
    expect(computeThreadUnknownBlockers(events, tasks, links)).toEqual([]);
  });

  it("skips link kinds outside requires/blocks", () => {
    const events = [ev(1, { start: "2026-06-20T10:00:00+09:00" })];
    const tasks = [tk(2)];
    const links = [link(5, "follows", eref(1, "발표"), tref(2, "슬라이드"))];
    expect(computeThreadUnknownBlockers(events, tasks, links)).toEqual([]);
  });

  it("soft/inferred links surface diagnostics but keep firmness/source evidence", () => {
    const events = [ev(1, { start: "2026-06-20T10:00:00+09:00" })];
    const tasks = [tk(2)];
    const links = [link(5, "requires", eref(1, "발표"), tref(2, "슬라이드"), "soft", "inferred")];
    const out = computeThreadUnknownBlockers(events, tasks, links);
    expect(out[0]).toMatchObject({ firmness: "soft", source: "inferred" });
    expect(out[0]!.reasonCodes).toContain("blocker_soft_link");
  });

  it("fail-open: estMinutes=0 is treated as known (only null is unknown)", () => {
    const events = [ev(1, { start: "2026-06-20T10:00:00+09:00" })];
    const tasks = [tk(2, { estMinutes: 0 })];
    const links = [link(5, "requires", eref(1, "발표"), tref(2, "슬라이드"))];
    expect(computeThreadUnknownBlockers(events, tasks, links)).toEqual([]);
  });

  it("sorts deterministically by linkId then field order", () => {
    const events = [ev(1, { start: "2026-06-20T10:00:00+09:00" }), ev(3)];
    const tasks = [tk(2, { due: "2026-06-25" })];
    // link 8: task1... actually two links, higher id first in input
    const links = [
      link(8, "requires", tref(2, "제출"), eref(3, "미팅")), // prereq event3 missing start+end, blocked task2 due
      link(4, "requires", eref(1, "발표"), tref(2, "슬라이드")) // prereq task2... estMinutes null? task2 has due but estMinutes null
    ];
    const out = computeThreadUnknownBlockers(events, tasks, links);
    expect(out.map((b) => b.linkId)).toEqual([4, 8, 8]);
    expect(out.slice(1).map((b) => b.missingField)).toEqual(["event.start", "event.end"]);
  });
});
