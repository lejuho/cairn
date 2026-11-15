import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventPeople } from "./EventPeople.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const person = (id: number, name: string, groups: string[]) => ({ id, name, relation: null, groups, channel: "kakao" });
const ALL = [person(1, "구예모", ["BAY"]), person(2, "이재근", ["BAY"]), person(3, "왕지우", [])];

describe("EventPeople", () => {
  it("shows who the event is with, adds someone found by name or group, and takes someone off", async () => {
    let current = [ALL[0]!];
    const puts: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      const u = String(url);
      const reply = (data: unknown) => Promise.resolve({ ok: true, status: 200, redirected: false, url: "", json: () => Promise.resolve({ ok: true, data }) });
      if (u === "/api/people") return reply(ALL);
      if (init?.method === "PUT") {
        const ids = (JSON.parse(String(init.body)) as { personIds: number[] }).personIds;
        puts.push(ids);
        current = ALL.filter((p) => ids.includes(p.id));
      }
      return reply({ event: { id: 7 }, people: current });
    }));
    render(<EventPeople eventId={7} />);

    expect(await screen.findByRole("link", { name: "구예모" })).toHaveAttribute("href", "/people/1");
    fireEvent.click(screen.getByRole("button", { name: "+ 참석자" }));
    // 이미 들어 있는 사람은 고를 목록에 없다.
    expect(await screen.findByRole("button", { name: "이재근 참석자로 넣기" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "구예모 참석자로 넣기" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("참석자 찾기"), { target: { value: "bay" } });
    expect(screen.queryByRole("button", { name: "왕지우 참석자로 넣기" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "이재근 참석자로 넣기" }));
    expect(await screen.findByRole("link", { name: "이재근" })).toBeInTheDocument();
    expect(puts).toEqual([[1, 2]]);

    fireEvent.click(screen.getByRole("button", { name: "구예모 참석자에서 빼기" }));
    await waitFor(() => expect(screen.queryByRole("link", { name: "구예모" })).not.toBeInTheDocument());
    expect(puts[1]).toEqual([2]);
  });
});
