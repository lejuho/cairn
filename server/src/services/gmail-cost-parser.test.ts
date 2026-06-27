import { describe, expect, it } from "vitest";
import { extractGmailCostEvidence } from "./gmail-cost-parser.js";

const EVENT_START = "2026-06-16T10:00:00+09:00";

describe("extractGmailCostEvidence — cancelMoney", () => {
  it("extracts a cancellation fee amount tied to fee context", () => {
    const r = extractGmailCostEvidence("예약 취소 시 취소 수수료 12,000원이 부과됩니다.", EVENT_START);
    expect(r.cancelMoney).toBe(12000);
  });

  it("extracts 위약금 amounts", () => {
    const r = extractGmailCostEvidence("위약금 30,000원 발생", EVENT_START);
    expect(r.cancelMoney).toBe(30000);
  });

  it("ignores a generic purchase total without cancellation context", () => {
    const r = extractGmailCostEvidence("결제금액 12000원 결제가 완료되었습니다.", EVENT_START);
    expect(r.cancelMoney).toBeUndefined();
  });

  it("ignores a purchase total even when an unrelated amount appears", () => {
    const r = extractGmailCostEvidence("상품금액 50,000원 / 배송비 3,000원", EVENT_START);
    expect(r.cancelMoney).toBeUndefined();
  });

  it("picks the amount nearest cancellation context when multiple amounts exist", () => {
    const r = extractGmailCostEvidence("결제금액 50,000원 / 취소 수수료 5,000원", EVENT_START);
    expect(r.cancelMoney).toBe(5000);
  });

  it("rejects an amount when a purchase keyword is closer than the fee keyword", () => {
    // Fee keyword present but the amount is bound to the purchase total.
    const r = extractGmailCostEvidence("취소 수수료 안내 — 결제금액 12,000원", EVENT_START);
    expect(r.cancelMoney).toBeUndefined();
  });
});

describe("extractGmailCostEvidence — refundCutoff", () => {
  it("normalizes a deadline date, inferring year from the event date", () => {
    const r = extractGmailCostEvidence("6월 30일까지 무료 취소 가능합니다.", EVENT_START);
    expect(r.refundCutoff).toBe("2026-06-30");
  });

  it("accepts an explicit full ISO deadline near refund context", () => {
    const r = extractGmailCostEvidence("환불 가능 기한: 2026-07-01 까지", EVENT_START);
    expect(r.refundCutoff).toBe("2026-07-01");
  });

  it("requires both a refund token and a deadline indicator", () => {
    const r = extractGmailCostEvidence("행사일은 6월 30일 입니다.", EVENT_START);
    expect(r.refundCutoff).toBeUndefined();
  });

  it("resolves the Dec→Jan boundary to the prior year", () => {
    const r = extractGmailCostEvidence("12월 28일까지 무료 취소", "2026-01-05T09:00:00+09:00");
    expect(r.refundCutoff).toBe("2025-12-28");
  });

  it("resolves the Jan→Dec boundary to the next year", () => {
    const r = extractGmailCostEvidence("1월 3일까지 환불 가능", "2026-12-30T09:00:00+09:00");
    expect(r.refundCutoff).toBe("2027-01-03");
  });

  it("rejects an impossible month/day", () => {
    const r = extractGmailCostEvidence("13월 40일까지 무료 취소", EVENT_START);
    expect(r.refundCutoff).toBeUndefined();
  });

  it("rejects a non-leap Feb 29 overflow date", () => {
    const r = extractGmailCostEvidence("2월 29일까지 무료 취소", "2027-02-01T09:00:00+09:00");
    expect(r.refundCutoff).toBeUndefined();
  });

  it("accepts a valid leap Feb 29 date", () => {
    const r = extractGmailCostEvidence("2월 29일까지 무료 취소", "2028-02-01T09:00:00+09:00");
    expect(r.refundCutoff).toBe("2028-02-29");
  });
});

describe("extractGmailCostEvidence — combined / empty", () => {
  it("returns empty evidence for unrelated receipts", () => {
    const r = extractGmailCostEvidence("주문이 접수되었습니다. 감사합니다.", EVENT_START);
    expect(r).toEqual({});
  });

  it("extracts both fields from a single message", () => {
    const r = extractGmailCostEvidence("취소 수수료 8,000원 / 6월 30일까지 무료 취소", EVENT_START);
    expect(r).toEqual({ cancelMoney: 8000, refundCutoff: "2026-06-30" });
  });
});
