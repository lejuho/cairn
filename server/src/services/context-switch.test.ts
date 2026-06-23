import { describe, expect, it } from "vitest";
import type { EventRow } from "@cairn/shared";
import { computeTransitionCosts, type ThreadLinkRow } from "./context-switch.js";

function ev(id: number, threadId: number | null, start: string, end: string): EventRow {
  return {
    id,
    threadId,
    title: `E${id}`,
    type: null,
    start,
    end,
    location: null,
    source: "cairn",
    selfImposed: 1,
    status: "planned",
    createdAt: null,
    updatedAt: null
  };
}

function link(id: number, fromThread: number, toThread: number, kind: ThreadLinkRow["kind"], firmness: ThreadLinkRow["firmness"] = "soft"): ThreadLinkRow {
  return { id, fromThread, toThread, kind, firmness };
}

const D = "2026-06-22";
const A = ev(1, 10, `${D}T09:00:00+09:00`, `${D}T10:00:00+09:00`);
const B = ev(2, 20, `${D}T10:30:00+09:00`, `${D}T11:30:00+09:00`);

describe("computeTransitionCosts — relation classification", () => {
  it("same thread → none", () => {
    const b = ev(2, 10, `${D}T10:30:00+09:00`, `${D}T11:30:00+09:00`);
    const r = computeTransitionCosts([A, b], []);
    expect(r).toHaveLength(1);
    expect(r[0]!.relation).toBe("same_thread");
    expect(r[0]!.costLevel).toBe("none");
    expect(r[0]!.reasonCodes).toEqual(["transition_same_thread"]);
  });

  it("contains link either direction → low context_link", () => {
    const fwd = computeTransitionCosts([A, B], [link(1, 10, 20, "contains")]);
    expect(fwd[0]!.relation).toBe("context_link");
    expect(fwd[0]!.costLevel).toBe("low");
    expect(fwd[0]!.relationKind).toBe("contains");
    // reverse direction (20→10) also resolves
    const rev = computeTransitionCosts([A, B], [link(1, 20, 10, "contains")]);
    expect(rev[0]!.costLevel).toBe("low");
  });

  it("shares and feeds → low context_link", () => {
    expect(computeTransitionCosts([A, B], [link(1, 10, 20, "shares")])[0]!.costLevel).toBe("low");
    expect(computeTransitionCosts([A, B], [link(1, 10, 20, "feeds")])[0]!.costLevel).toBe("low");
  });

  it("blocks/competes only → high non_context_link with distinct reason", () => {
    const blk = computeTransitionCosts([A, B], [link(1, 10, 20, "blocks")]);
    expect(blk[0]!.relation).toBe("non_context_link");
    expect(blk[0]!.costLevel).toBe("high");
    expect(blk[0]!.reasonCodes).toEqual(["transition_non_context_link"]);
    expect(computeTransitionCosts([A, B], [link(1, 10, 20, "competes")])[0]!.costLevel).toBe("high");
  });

  it("no link → high unrelated", () => {
    const r = computeTransitionCosts([A, B], []);
    expect(r[0]!.relation).toBe("unrelated");
    expect(r[0]!.costLevel).toBe("high");
    expect(r[0]!.reasonCodes).toEqual(["transition_unrelated"]);
  });

  it("missing thread id (either side) → unknown", () => {
    const noThread = ev(2, null, `${D}T10:30:00+09:00`, `${D}T11:30:00+09:00`);
    const r = computeTransitionCosts([A, noThread], []);
    expect(r[0]!.relation).toBe("missing_thread");
    expect(r[0]!.costLevel).toBe("unknown");
    expect(r[0]!.fromThreadId).toBe(10);
    expect(r[0]!.toThreadId).toBeNull();
  });
});

describe("computeTransitionCosts — deterministic multi-link resolution", () => {
  it("context kind wins over non-context even if ordinally later", () => {
    // feeds(context) vs blocks(non-context): feeds wins → low
    const r = computeTransitionCosts([A, B], [
      link(1, 10, 20, "blocks", "hard"),
      link(2, 10, 20, "feeds", "soft")
    ]);
    expect(r[0]!.costLevel).toBe("low");
    expect(r[0]!.relationKind).toBe("feeds");
  });

  it("within context class, kind order contains < shares < feeds", () => {
    const r = computeTransitionCosts([A, B], [
      link(1, 10, 20, "feeds"),
      link(2, 10, 20, "contains"),
      link(3, 10, 20, "shares")
    ]);
    expect(r[0]!.relationKind).toBe("contains");
  });

  it("within same kind, firmness hard < soft", () => {
    const r = computeTransitionCosts([A, B], [
      link(1, 10, 20, "feeds", "soft"),
      link(2, 10, 20, "feeds", "hard")
    ]);
    expect(r[0]!.firmness).toBe("hard");
  });

  it("within same kind+firmness, lower link id wins", () => {
    const r = computeTransitionCosts([A, B], [
      link(5, 10, 20, "feeds", "soft"),
      link(2, 10, 20, "feeds", "soft")
    ]);
    // both context_link/low; relationKind feeds; tie broken by id (no observable
    // field differs, but selection must be deterministic — assert stable output)
    expect(r[0]!.relationKind).toBe("feeds");
    expect(r[0]!.costLevel).toBe("low");
  });

  it("non-context only resolves blocks < competes", () => {
    const r = computeTransitionCosts([A, B], [
      link(1, 10, 20, "competes"),
      link(2, 10, 20, "blocks")
    ]);
    expect(r[0]!.relationKind).toBe("blocks");
    expect(r[0]!.costLevel).toBe("high");
  });
});

describe("computeTransitionCosts — pairing", () => {
  it("emits one row per consecutive pair (N events → N-1 rows)", () => {
    const c = ev(3, 30, `${D}T12:00:00+09:00`, `${D}T13:00:00+09:00`);
    expect(computeTransitionCosts([A, B, c], [])).toHaveLength(2);
  });

  it("single event → no transitions", () => {
    expect(computeTransitionCosts([A], [])).toHaveLength(0);
  });

  it("empty input → no transitions", () => {
    expect(computeTransitionCosts([], [])).toHaveLength(0);
  });

  it("links not between the pair's threads are ignored", () => {
    // link between 10 and 99 must not affect the 10→20 pair
    const r = computeTransitionCosts([A, B], [link(1, 10, 99, "contains")]);
    expect(r[0]!.relation).toBe("unrelated");
  });
});
