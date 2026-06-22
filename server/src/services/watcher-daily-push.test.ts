import { describe, expect, it } from "vitest";
import { selectDueForPush } from "./watcher-daily-push.js";
import type { WatcherRow } from "@cairn/shared";

const DATE = "2026-06-23";
const NOW = "2026-06-23T09:00:00+09:00";

function makeRow(overrides: Partial<WatcherRow> = {}): WatcherRow {
  return {
    id: 1,
    category: null,
    label: "테스트 watcher",
    kind: "A",
    armed: 1,
    threshold: "2026-06-20",
    rule: null,
    lastFired: null,
    snoozedUntil: null,
    createdAt: "2026-01-01T00:00:00",
    ...overrides
  } as WatcherRow;
}

describe("selectDueForPush — selection", () => {
  it("selects due watcher with days overdue", () => {
    const { items } = selectDueForPush([makeRow()], DATE, NOW);
    expect(items).toHaveLength(1);
    expect(items[0]!.daysOverdue).toBe(3);
  });

  it("selects watcher with threshold exactly today (zero overdue days)", () => {
    const { items } = selectDueForPush([makeRow({ threshold: DATE })], DATE, NOW);
    expect(items).toHaveLength(1);
    expect(items[0]!.daysOverdue).toBe(0);
  });

  it("skips future watcher (threshold > date)", () => {
    const { items } = selectDueForPush([makeRow({ threshold: "2026-07-01" })], DATE, NOW);
    expect(items).toHaveLength(0);
  });

  it("skips disarmed watcher (armed = 0)", () => {
    const { items } = selectDueForPush([makeRow({ armed: 0 })], DATE, NOW);
    expect(items).toHaveLength(0);
  });

  it("skips active snooze", () => {
    const { items } = selectDueForPush(
      [makeRow({ snoozedUntil: "2026-06-24T00:00:00+09:00" })],
      DATE, NOW
    );
    expect(items).toHaveLength(0);
  });

  it("selects expired snooze (snoozedUntil <= now)", () => {
    const { items } = selectDueForPush(
      [makeRow({ snoozedUntil: "2026-06-22T00:00:00+09:00" })],
      DATE, NOW
    );
    expect(items).toHaveLength(1);
  });

  it("skips unsupported kind", () => {
    const { items } = selectDueForPush([makeRow({ kind: "B" })], DATE, NOW);
    expect(items).toHaveLength(0);
  });

  it("skips same-date last_fired", () => {
    const { items } = selectDueForPush(
      [makeRow({ lastFired: "2026-06-23T05:00:00.000Z" })],
      DATE, NOW
    );
    expect(items).toHaveLength(0);
  });

  it("selects older last_fired (different date)", () => {
    const { items } = selectDueForPush(
      [makeRow({ lastFired: "2026-06-22T05:00:00.000Z" })],
      DATE, NOW
    );
    expect(items).toHaveLength(1);
  });

  it("uses rule.fireOn when rule is valid, ignores threshold column", () => {
    const { items } = selectDueForPush(
      [makeRow({ rule: '{"type":"date_threshold","fireOn":"2026-06-20"}', threshold: "9999-01-01" })],
      DATE, NOW
    );
    expect(items).toHaveLength(1);
    expect(items[0]!.threshold).toBe("2026-06-20");
  });

  it("falls back to threshold column when rule is malformed", () => {
    const { items } = selectDueForPush(
      [makeRow({ rule: "bad-json", threshold: "2026-06-20" })],
      DATE, NOW
    );
    expect(items).toHaveLength(1);
    expect(items[0]!.threshold).toBe("2026-06-20");
  });

  it("skips when both rule malformed and threshold null", () => {
    const { items } = selectDueForPush(
      [makeRow({ rule: "bad-json", threshold: null })],
      DATE, NOW
    );
    expect(items).toHaveLength(0);
  });
});

describe("selectDueForPush — sort order", () => {
  it("sorts by threshold asc, then id asc", () => {
    const rows = [
      makeRow({ id: 3, threshold: "2026-06-20" }),
      makeRow({ id: 1, threshold: "2026-06-21" }),
      makeRow({ id: 2, threshold: "2026-06-20" })
    ];
    const { items } = selectDueForPush(rows, DATE, NOW);
    expect(items.map((i) => i.id)).toEqual([2, 3, 1]);
  });
});

describe("selectDueForPush — message", () => {
  it("returns empty message when no items", () => {
    const { message } = selectDueForPush([], DATE, NOW);
    expect(message).toBe("");
  });

  it("includes count header and watcher lines", () => {
    const { message } = selectDueForPush([makeRow()], DATE, NOW);
    expect(message).toContain("확인할 watcher 1개");
    expect(message).toContain("테스트 watcher");
    expect(message).toContain("3일 지남");
  });

  it("includes category in square brackets when present", () => {
    const { message } = selectDueForPush(
      [makeRow({ category: "travel" })],
      DATE, NOW
    );
    expect(message).toContain("[travel]");
  });

  it("shows 오늘 마감 for threshold == date", () => {
    const { message } = selectDueForPush([makeRow({ threshold: DATE })], DATE, NOW);
    expect(message).toContain("오늘 마감");
  });

  it("shows (이름 없음) when label is null", () => {
    const { message } = selectDueForPush([makeRow({ label: null })], DATE, NOW);
    expect(message).toContain("(이름 없음)");
  });
});
