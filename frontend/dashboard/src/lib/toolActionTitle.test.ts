import { describe, expect, it } from "vitest";
import {
  extractDiffTextFromResult,
  fallbackToolActionTitle,
  looksLikeRawToolJson,
  sanitizeToolActionTitle,
} from "./toolActionTitle";

describe("toolActionTitle", () => {
  const diff = [
    "diff --git a/agent/tool_result_status.py b/agent/tool_result_status.py",
    "--- a/agent/tool_result_status.py",
    "+++ b/agent/tool_result_status.py",
    "@@ -1,1 +1,2 @@",
    "+x",
  ].join("\n");

  it("detecta JSON bruto de tool", () => {
    expect(looksLikeRawToolJson(`{"output": "hello"}`)).toBe(true);
    expect(looksLikeRawToolJson("diff --git a/x b/x")).toBe(false);
  });

  it("extrai diff de campo output", () => {
    const raw = JSON.stringify({ output: diff, exit_code: 0 });
    expect(extractDiffTextFromResult(raw)).toContain("diff --git");
  });

  it("fallback usa path do diff em vez de JSON", () => {
    const raw = JSON.stringify({ output: diff });
    expect(fallbackToolActionTitle("terminal", "{}", raw)).toBe(
      "agent/tool_result_status.py",
    );
  });

  it("sanitize substitui título JSON", () => {
    const raw = JSON.stringify({ output: diff });
    expect(
      sanitizeToolActionTitle(
        `{"output": "diff --git a/agent/tool_result_status.py`,
        "terminal",
        "{}",
        raw,
      ),
    ).toBe("agent/tool_result_status.py");
  });

  it("sanitize substitui aviso de file_state pelo path", () => {
    expect(
      sanitizeToolActionTitle(
        "/Users/dev/Documents/develop-personal/sn-agent/.gitignore was last read with offset/limit pagination (partial view).",
        "write_file",
        JSON.stringify({
          path: "/Users/dev/Documents/develop-personal/sn-agent/.gitignore",
        }),
      ),
    ).toBe("Documents/develop-personal/sn-agent/.gitignore");
  });
});
