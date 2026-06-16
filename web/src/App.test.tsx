import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "./App.js";

afterEach(() => {
  cleanup();
});

describe("App shell", () => {
  it("redirects / to /today and renders the quiet state", () => {
    window.history.replaceState(null, "", "/");
    render(<App />);

    expect(window.location.pathname).toBe("/today");
    expect(screen.getByTestId("today-quiet")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "오늘은 조용해" })).toBeInTheDocument();
  });

  it("renders /today quiet state directly", () => {
    window.history.replaceState(null, "", "/today");
    render(<App />);

    expect(screen.getByText("새로 생기면 올려둘게. 닫고 네 일 해도 돼.")).toBeInTheDocument();
  });
});
