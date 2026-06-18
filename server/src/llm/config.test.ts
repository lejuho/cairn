import { afterEach, describe, expect, it } from "vitest";
import { getLlmModel } from "./config.js";

describe("LLM config", () => {
  afterEach(() => {
    delete process.env.LLM_MODEL;
  });

  it("defaults to a supported Grok model", () => {
    delete process.env.LLM_MODEL;
    expect(getLlmModel()).toBe("grok-3-mini");
  });

  it("uses trimmed LLM_MODEL when configured", () => {
    process.env.LLM_MODEL = "  grok-custom  ";
    expect(getLlmModel()).toBe("grok-custom");
  });

  it("falls back when LLM_MODEL is blank", () => {
    process.env.LLM_MODEL = "   ";
    expect(getLlmModel()).toBe("grok-3-mini");
  });
});
