import { describe, expect, it } from "vitest";
import {
  formatProcessWaitCountdown,
  formatProcessWaitTitle,
  humanizeProcessWaitLiveLabel,
  isProcessWaitishLabel,
  parseProcessWaitMeta,
} from "./processWaitLabel";

describe("parseProcessWaitMeta", () => {
  it("lê timeout dos args de process wait", () => {
    expect(
      parseProcessWaitMeta({
        name: "process",
        args: JSON.stringify({
          action: "wait",
          session_id: "proc_abc123",
          timeout: 600,
        }),
        liveLabel: "wait proc_abc123 600s",
      }),
    ).toEqual({ timeoutSec: 600, sessionId: "proc_abc123" });
  });

  it("faz fallback pelo liveLabel em inglês", () => {
    expect(
      parseProcessWaitMeta({
        name: "process",
        args: "{}",
        liveLabel: "wait proc_45aeb379d3a 600s",
      }),
    ).toEqual({ timeoutSec: 600, sessionId: "proc_45aeb379d3a" });
  });
});

describe("humanizeProcessWaitLiveLabel", () => {
  it("traduz preview legado", () => {
    expect(humanizeProcessWaitLiveLabel("wait proc_45aeb379d3a 600s")).toBe(
      "Aguardando o processo",
    );
  });
});

describe("formatProcessWaitTitle", () => {
  it("formata contagem regressiva estilo mm:ss", () => {
    expect(formatProcessWaitTitle(598)).toBe("Aguardando o processo · 9:58");
    expect(formatProcessWaitCountdown(45)).toBe("45s");
  });
});

describe("isProcessWaitishLabel", () => {
  it("reconhece previews de wait em pt e en", () => {
    expect(isProcessWaitishLabel("aguardando processo (600s)")).toBe(true);
    expect(isProcessWaitishLabel("wait proc_abc 600s")).toBe(true);
    expect(isProcessWaitishLabel("Listando arquivos")).toBe(false);
  });
});
