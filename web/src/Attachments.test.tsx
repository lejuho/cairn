import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { NoteView } from "@cairn/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoteAttachments, PendingAttachments, formatSize, sendPending, type PendingAttachment } from "./Attachments.js";
import { NoteFlow } from "./Notes.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function note(over: Partial<NoteView> = {}): NoteView {
  return {
    id: 1, kind: "note", title: null, body: "회의 자료", noteDate: "2026-03-12", pinned: false, remoteVisible: false,
    items: [], links: [], attachments: [], addedBy: "web", createdAt: "2026-03-12T06:00:00.000Z", updatedAt: "2026-03-12T06:00:00.000Z", archivedAt: null,
    ...over
  };
}

const PHOTO = { id: 5, kind: "file" as const, name: "칠판.png", url: "/api/files/3", fileId: 3, mime: "image/png", size: 2_400_000 };
const DOC = { id: 6, kind: "file" as const, name: "안건.pdf", url: "/api/files/4", fileId: 4, mime: "application/pdf", size: 81_000 };
const DRIVE = { id: 7, kind: "link" as const, name: "세션 녹화본", url: "https://drive.google.com/file/d/abc/view", fileId: null, mime: null, size: null };

function json(data: unknown) {
  return { ok: true, status: 200, redirected: false, url: "", json: () => Promise.resolve({ ok: true, data }) };
}

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

function stub(reply: (call: Call) => unknown) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    const call = { url: String(url), method: init?.method ?? "GET", headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body };
    calls.push(call);
    return Promise.resolve(reply(call));
  }));
  return calls;
}

function big(name: string, bytes: number): File {
  const file = new File(["x"], name, { type: "video/mp4" });
  Object.defineProperty(file, "size", { value: bytes });
  return file;
}

describe("NoteAttachments", () => {
  it("shows files and links, uploads a picked file as raw bytes and can take one off", async () => {
    let current = note({ attachments: [PHOTO, DRIVE] });
    const calls = stub((call) => {
      if (call.method === "POST") current = { ...current, attachments: [...(current.attachments ?? []), DOC] };
      if (call.method === "DELETE") current = { ...current, attachments: (current.attachments ?? []).filter((a) => a.id !== 5) };
      return json({ note: current });
    });
    const changed = vi.fn();
    const view = render(<NoteAttachments note={current} onChanged={changed} />);

    expect(screen.getByRole("link", { name: "칠판.png 열기" })).toHaveAttribute("href", "/api/files/3");
    expect(screen.getByText("2.3MB")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "세션 녹화본 링크 열기" })).toHaveAttribute("href", DRIVE.url);

    const file = new File(["안건"], "안건.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByTestId("attachment-file-input"), { target: { files: [file] } });
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    expect(calls[0]).toMatchObject({
      url: "/api/notes/1/files", method: "POST",
      headers: { "content-type": "application/octet-stream", "x-file-name": encodeURIComponent("안건.pdf"), "x-file-type": encodeURIComponent("application/pdf") }
    });
    expect(calls[0]!.body).toBe(file);

    view.rerender(<NoteAttachments note={current} onChanged={changed} />);
    fireEvent.click(screen.getByRole("button", { name: "칠판.png 첨부 빼기" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url === "/api/notes/1/attachments/5")).toBe(true));
  });

  it("turns away a file over 50MB and points to a link instead", async () => {
    const calls = stub(() => json({ note: note({ attachments: [DRIVE] }) }));
    const changed = vi.fn();
    render(<NoteAttachments note={note()} onChanged={changed} />);

    fireEvent.change(screen.getByTestId("attachment-file-input"), { target: { files: [big("녹화본.mp4", 60 * 1024 * 1024)] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("50MB를 넘는 파일입니다. 구글 드라이브 등에 올린 뒤 링크로 붙이세요.");
    expect(calls).toHaveLength(0);

    // 링크 입력이 바로 열려 있다.
    fireEvent.change(screen.getByLabelText("붙일 링크 주소"), { target: { value: "드라이브" } });
    fireEvent.click(screen.getByRole("button", { name: "붙이기" }));
    expect(screen.getByRole("alert")).toHaveTextContent("http 또는 https 로 시작하는 주소를 넣으세요.");
    fireEvent.change(screen.getByLabelText("붙일 링크 주소"), { target: { value: DRIVE.url } });
    fireEvent.click(screen.getByRole("button", { name: "붙이기" }));
    await waitFor(() => expect(changed).toHaveBeenCalled());
    expect(calls[0]).toMatchObject({ url: "/api/notes/1/links", method: "POST", body: JSON.stringify({ url: DRIVE.url }) });
  });
});

describe("attachments on a new note", () => {
  it("keeps what was picked until the note is saved, then sends it", async () => {
    const calls = stub((call) => json({ note: note({ id: 9, attachments: call.url.endsWith("/links") ? [DOC, DRIVE] : call.url.endsWith("/files") ? [DOC] : [] }) }));
    const saved = vi.fn();
    render(<NoteFlow defaultDate="2026-03-12" onClose={() => undefined} onSaved={saved} />);

    fireEvent.change(screen.getAllByRole("textbox")[0]!, { target: { value: "회의 자료" } });
    fireEvent.click(screen.getByRole("button", { name: /다음: 붙일 곳/ }));
    fireEvent.change(screen.getByTestId("attachment-file-input"), { target: { files: [new File(["안건"], "안건.pdf", { type: "application/pdf" })] } });
    fireEvent.click(screen.getByRole("button", { name: "+ 링크" }));
    fireEvent.change(screen.getByLabelText("붙일 링크 주소"), { target: { value: DRIVE.url } });
    fireEvent.click(screen.getByRole("button", { name: "붙이기" }));
    expect(screen.getByText("안건.pdf")).toBeInTheDocument();
    expect(calls.filter((c) => c.method !== "GET")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: /^저장 \(.*첨부 2/ }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.url}`)).toEqual(["POST /api/notes", "POST /api/notes/9/files", "POST /api/notes/9/links"]);
    expect(saved.mock.calls[0]![0].attachments).toEqual([DOC, DRIVE]);
  });

  it("sends pending items in order", async () => {
    const calls = stub(() => json({ note: note({ id: 4 }) }));
    const pending: PendingAttachment[] = [{ key: 1, url: "https://example.com/a" }, { key: 2, file: new File(["x"], "a.txt", { type: "text/plain" }) }];
    await sendPending(note({ id: 4 }), pending);
    expect(calls.map((c) => c.url)).toEqual(["/api/notes/4/links", "/api/notes/4/files"]);
    render(<PendingAttachments pending={pending} onChange={() => undefined} />);
    expect(screen.getByText("https://example.com/a")).toBeInTheDocument();
  });
});

describe("formatSize", () => {
  it("reads as a person would say it", () => {
    expect(formatSize(900)).toBe("900B");
    expect(formatSize(81_000)).toBe("79KB");
    expect(formatSize(2_400_000)).toBe("2.3MB");
    expect(formatSize(48 * 1024 * 1024)).toBe("48MB");
    expect(formatSize(null)).toBe("");
  });
});
