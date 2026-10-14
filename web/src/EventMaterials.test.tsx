import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { EventMaterialView } from "@cairn/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventMaterials } from "./EventMaterials.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function material(over: Partial<EventMaterialView>): EventMaterialView {
  return {
    id: 1, eventId: 158, kind: "slides", status: "available", label: null, url: null, expectedAt: null,
    sourceUrl: null, note: null, addedBy: null, missingReason: null, createdAt: null, updatedAt: null, ...over
  };
}

function ok(data: unknown) {
  return Promise.resolve({ json: () => Promise.resolve({ ok: true, data }) });
}

describe("EventMaterials", () => {
  it("renders available links, expected dates with source, and auto-expired state without fetching", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(
      <EventMaterials
        eventId={158}
        initial={[
          material({ id: 1, label: "카나나 세션", url: "https://if.kakao.com/s/1" }),
          material({ id: 2, kind: "video", status: "expected", expectedAt: "2026-10-31T01:00:00.000Z", sourceUrl: "https://www.youtube.com/@kakaotech" }),
          material({ id: 3, kind: "recording", status: "missing", missingReason: "auto_expired" })
        ]}
      />
    );
    expect(screen.getByRole("link", { name: "카나나 세션" })).toHaveAttribute("href", "https://if.kakao.com/s/1");
    expect(screen.getByText("10. 31. 공개 예정")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "출처" })).toHaveAttribute("href", "https://www.youtube.com/@kakaotech");
    expect(screen.getByText("확인 못 함 (자동 정리)")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("attaches a link and refreshes the list", async () => {
    const added = material({ id: 9, kind: "video", url: "https://youtu.be/x", label: "키노트" });
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => ok({ material: added }))
      .mockImplementationOnce(() => ok({ materials: [added] }));
    vi.stubGlobal("fetch", fetchMock);
    render(<EventMaterials eventId={158} initial={[]} />);

    fireEvent.change(screen.getByLabelText("자료 종류"), { target: { value: "video" } });
    fireEvent.change(screen.getByLabelText("세션명"), { target: { value: "키노트" } });
    fireEvent.change(screen.getByLabelText("자료 링크 입력"), { target: { value: "https://youtu.be/x" } });
    fireEvent.click(screen.getByLabelText("자료 붙이기 제출"));

    await waitFor(() => expect(screen.getByRole("link", { name: "키노트" })).toBeInTheDocument());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/events/158/materials");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ kind: "video", url: "https://youtu.be/x", label: "키노트", addedBy: "web" });
  });

  it("fills an expected material with a link via PATCH", async () => {
    const filled = material({ id: 2, kind: "video", url: "https://youtu.be/vod" });
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => ok({ material: filled }))
      .mockImplementationOnce(() => ok({ materials: [filled] }));
    vi.stubGlobal("fetch", fetchMock);
    render(<EventMaterials eventId={158} initial={[material({ id: 2, kind: "video", status: "expected", expectedAt: "2026-10-31T01:00:00.000Z" })]} />);

    fireEvent.click(screen.getByRole("button", { name: "링크 넣기" }));
    fireEvent.change(screen.getByLabelText("자료 링크"), { target: { value: "https://youtu.be/vod" } });
    fireEvent.click(screen.getByLabelText("링크 저장"));

    await waitFor(() => expect(screen.getByRole("link", { name: "https://youtu.be/vod" })).toBeInTheDocument());
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/materials/2");
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)).toEqual({ status: "available", url: "https://youtu.be/vod" });
  });

  it("shows the server error when attaching fails", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ ok: false, error: { message: "available material needs url or note" } }) })));
    render(<EventMaterials eventId={158} initial={[]} />);
    fireEvent.change(screen.getByLabelText("자료 링크 입력"), { target: { value: "https://x.y" } });
    fireEvent.click(screen.getByLabelText("자료 붙이기 제출"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("available material needs url or note"));
  });
});
