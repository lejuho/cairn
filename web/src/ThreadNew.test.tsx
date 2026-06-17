import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadNew } from "./ThreadNew.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ThreadNew — validation", () => {
  it("submit button disabled when name is empty", () => {
    render(<ThreadNew />);
    const btn = screen.getByLabelText("스레드 만들기 제출");
    expect(btn).toBeDisabled();
  });

  it("submit button enabled when name is non-empty", () => {
    render(<ThreadNew />);
    fireEvent.change(screen.getByLabelText(/이름/), { target: { value: "Project" } });
    expect(screen.getByLabelText("스레드 만들기 제출")).not.toBeDisabled();
  });

  it("does not call fetch when name is blank after trim", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<ThreadNew />);
    fireEvent.change(screen.getByLabelText(/이름/), { target: { value: "   " } });
    fireEvent.click(screen.getByLabelText("스레드 만들기 제출"));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("ThreadNew — submission", () => {
  it("posts to /api/threads and navigates on success", async () => {
    Object.defineProperty(window, "location", {
      value: { href: "/threads/new" },
      writable: true
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true, data: { id: 5 } })
    }));

    render(<ThreadNew />);
    fireEvent.change(screen.getByLabelText(/이름/), { target: { value: "My Thread" } });
    fireEvent.click(screen.getByLabelText("스레드 만들기 제출"));

    await waitFor(() => {
      expect(window.location.href).toBe("/threads/5");
    });
    expect((vi.mocked(fetch) as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      "/api/threads",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("shows error and keeps form values on failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: false, error: { message: "이미 있음" } })
    }));

    render(<ThreadNew />);
    fireEvent.change(screen.getByLabelText(/이름/), { target: { value: "Dup" } });
    fireEvent.click(screen.getByLabelText("스레드 만들기 제출"));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByLabelText(/이름/)).toHaveValue("Dup");
  });
});
