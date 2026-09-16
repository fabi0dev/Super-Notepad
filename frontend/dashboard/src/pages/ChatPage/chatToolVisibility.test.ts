import { describe, expect, it } from "vitest";
import { isRealToolName, shouldCreateToolCard } from "./chatToolVisibility";

describe("chatToolVisibility", () => {
  it("rejeita placeholder e thinking", () => {
    expect(isRealToolName("tool")).toBe(false);
    expect(isRealToolName("_thinking")).toBe(false);
    expect(isRealToolName("thinking")).toBe(false);
    expect(isRealToolName("terminal")).toBe(true);
  });

  it("não cria card para raciocínio interno", () => {
    expect(
      shouldCreateToolCard("_thinking", "reasoning.available"),
    ).toBe(false);
    expect(shouldCreateToolCard("terminal", "tool.started")).toBe(true);
    expect(shouldCreateToolCard("tool", "tool.started")).toBe(false);
  });
});
