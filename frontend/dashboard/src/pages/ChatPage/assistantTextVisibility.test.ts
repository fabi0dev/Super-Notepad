import { describe, expect, it } from "vitest";
import { hasVisibleAssistantText, isSubstantiveThinkingText } from "./reasoningLabels";

describe("assistant text visibility", () => {
  it("shows short replies and hides planning garbage", () => {
    expect(hasVisibleAssistantText("Sim")).toBe(true);
    expect(isSubstantiveThinkingText("O6P")).toBe(false);
  });
});
