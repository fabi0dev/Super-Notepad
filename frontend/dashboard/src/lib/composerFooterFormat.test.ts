import { describe, expect, it } from "vitest";
import {
  composerCostLabel,
  cwdDirName,
  hasGitActivity,
  isTruncatedCwdLabel,
  shortCwdLabel,
  shortModelLabel,
  toHomeRelativePath,
} from "./composerFooterFormat";

describe("cwdDirName", () => {
  it("returns basename of absolute path", () => {
    expect(cwdDirName("/Users/dev/Documents/axis-app")).toBe("axis-app");
  });

  it("handles home path", () => {
    expect(cwdDirName("~")).toBe("~");
  });
});

describe("hasGitActivity", () => {
  it("is true when modified or untracked", () => {
    expect(hasGitActivity(2, 0)).toBe(true);
    expect(hasGitActivity(0, 1)).toBe(true);
    expect(hasGitActivity(0, 0)).toBe(false);
  });
});

describe("toHomeRelativePath", () => {
  it("collapses /Users/… to ~", () => {
    expect(
      toHomeRelativePath("/Users/dev/Documents/develop-personal/sn-agent"),
    ).toBe("~/Documents/develop-personal/sn-agent");
  });

  it("keeps existing ~ prefix", () => {
    expect(toHomeRelativePath("~/Documents/proj")).toBe("~/Documents/proj");
  });

  it("leaves non-home paths intact", () => {
    expect(toHomeRelativePath("/tmp/work")).toBe("/tmp/work");
  });
});

describe("shortCwdLabel", () => {
  it("does not pre-truncate long paths", () => {
    const path = "/Users/dev/Documents/develop/axis-project/axis";
    expect(shortCwdLabel(path)).toBe("~/Documents/develop/axis-project/axis");
  });
});

describe("isTruncatedCwdLabel", () => {
  it("detects legacy ellipsis labels", () => {
    expect(isTruncatedCwdLabel("…develop/axis")).toBe(true);
    expect(isTruncatedCwdLabel("~/Documents/proj")).toBe(false);
  });
});

describe("shortModelLabel", () => {
  it("merges spaced version digits like TUI statusBarHelpers", () => {
    expect(shortModelLabel("anthropic/claude 3 5 sonnet")).toBe(
      "claude 3.5 sonnet",
    );
  });

  it("strips provider prefix and normalizes separators", () => {
    expect(shortModelLabel("deepseek/deepseek-v4-flash")).toBe(
      "deepseek v4 flash",
    );
  });
});

describe("composerCostLabel", () => {
  it("is empty when show_cost is off", () => {
    expect(
      composerCostLabel({ show_cost: false, cost_usd: 0.05, cost_status: "actual" }),
    ).toBe("");
  });

  it("formats exact cost", () => {
    expect(
      composerCostLabel({ show_cost: true, cost_usd: 0.0421, cost_status: "actual" }),
    ).toBe("$0.042");
  });

  it("prefixes estimated cost", () => {
    expect(
      composerCostLabel({
        show_cost: true,
        cost_usd: 0.01,
        cost_status: "estimated",
      }),
    ).toBe("~$0.010");
  });

  it("hides zero or negative cost", () => {
    expect(
      composerCostLabel({ show_cost: true, cost_usd: 0, cost_status: "actual" }),
    ).toBe("");
  });
});

describe("siglas do nome do modelo", () => {
  it("GLM em caixa alta — o id vem minúsculo do provedor", () => {
    // "glm 4.7 flash" lê como erro de digitação; é nome próprio de família.
    expect(shortModelLabel("glm-4.7-flash")).toBe("GLM 4.7 flash");
    expect(shortModelLabel("zai/glm-5.2")).toBe("GLM 5.2");
  });

  it("GPT também", () => {
    expect(shortModelLabel("gpt-5.4-mini")).toBe("GPT 5.4 mini");
  });

  it("palavras comuns continuam minúsculas", () => {
    // "flash", "turbo", "mini", "pro" são palavras, não siglas.
    expect(shortModelLabel("glm-5-turbo")).toBe("GLM 5 turbo");
    expect(shortModelLabel("gpt-5.5-pro")).toBe("GPT 5.5 pro");
  });

  it("não mexe em nomes que não são sigla", () => {
    expect(shortModelLabel("claude-sonnet-5")).toBe("sonnet 5");
    expect(shortModelLabel("qwen3-coder")).toBe("qwen3 coder");
  });
})
