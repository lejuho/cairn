import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResultCard } from "./ResultCard.js";

afterEach(() => cleanup());

describe("ResultCard (cycle-68)", () => {
  it("renders kind, title, status and an accessible status region", () => {
    render(<ResultCard kind="일정" title="치과" status="저장됐어" primary={{ label: "Today에서 보기", href: "/today" }} testId="rc" />);
    const card = screen.getByTestId("rc");
    expect(card).toHaveAttribute("role", "status");
    expect(card).toHaveAttribute("aria-live", "polite");
    expect(card).toHaveTextContent("일정");
    expect(card).toHaveTextContent("치과");
    expect(card).toHaveTextContent("저장됐어");
  });

  it("renders the primary action as a link when href is set", () => {
    render(<ResultCard kind="스레드 초안" status="초안이 만들어졌어" primary={{ label: "스레드 열기", href: "/threads/9", testId: "go" }} />);
    const link = screen.getByTestId("go");
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/threads/9");
    expect(link).toHaveTextContent("스레드 열기");
  });

  it("renders the primary action as a button when onClick is set and fires it", () => {
    const onClick = vi.fn();
    render(<ResultCard kind="미정 일정" status="날짜 없이 저장됐어" primary={{ label: "날짜 잡기", onClick, testId: "act" }} />);
    const btn = screen.getByTestId("act");
    expect(btn.tagName).toBe("BUTTON");
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders optional secondary content", () => {
    render(<ResultCard kind="할 일" status="저장됐어" primary={{ label: "x", href: "/today" }} secondary={<span>부가 설명</span>} />);
    expect(screen.getByText("부가 설명")).toBeInTheDocument();
  });
});
