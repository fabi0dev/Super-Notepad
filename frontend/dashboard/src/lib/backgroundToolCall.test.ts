import { describe, expect, it } from "vitest";
import {
  BACKGROUND_STARTED_OUTPUT,
  detectBackgroundSpawn,
  enrichBackgroundRunningTool,
  enrichMessageBackgroundTools,
  extractLiveBackgroundStdout,
  formatBackgroundUptime,
  hasBackgroundExitedMarker,
  isBackgroundSpawnResult,
  isTerminalBackgroundArgs,
  mergeRunningBackgroundProgress,
  messageHasBackgroundSpawnCandidate,
  readBackgroundUptimeSeconds,
} from "./backgroundToolCall";
import type { ChatMessage, ToolCallEvent } from "@/pages/ChatPage/components/types";

const ARGS = JSON.stringify({
  background: true,
  description: "Build APK staging",
  command: "./gradlew assembleStagingRelease",
});

const RESULT = JSON.stringify({
  output: BACKGROUND_STARTED_OUTPUT,
  session_id: "proc_abc123",
  pid: 4242,
  exit_code: 0,
});

describe("backgroundToolCall", () => {
  it("detecta spawn em background do terminal", () => {
    const bg = detectBackgroundSpawn("terminal", ARGS, RESULT);
    expect(bg).toEqual({
      procSessionId: "proc_abc123",
      liveLabel: "Build APK staging — executando em segundo plano…",
    });
  });

  it("detecta spawn só pelo resultado, sem args.background", () => {
    const bg = detectBackgroundSpawn(
      "terminal",
      JSON.stringify({ command: "gradle build" }),
      RESULT,
      "Build APK",
    );
    expect(bg?.procSessionId).toBe("proc_abc123");
    expect(bg?.liveLabel).toContain("Build APK");
    expect(bg?.liveLabel).toContain("segundo plano");
  });

  it("ignora ferramentas que não são terminal/shell", () => {
    expect(detectBackgroundSpawn("read_file", ARGS, RESULT)).toBeNull();
  });

  it("enrichBackgroundRunningTool mantém status running", () => {
    const tc: ToolCallEvent = {
      id: "t1",
      name: "terminal",
      args: ARGS,
      result: RESULT,
      status: "complete",
    };
    const enriched = enrichBackgroundRunningTool(tc);
    expect(enriched.status).toBe("running");
    expect(enriched.backgroundProcId).toBe("proc_abc123");
    expect(enriched.liveLabel).toContain("segundo plano");
  });

  it("usa a hora real do spawn (não Date.now) quando informada", () => {
    // Sem isso, um processo antigo recarregado aparecia como "0s" contando do
    // zero, parecendo recém-iniciado.
    const spawn = 1_700_000_000_000;
    const enriched = enrichBackgroundRunningTool(
      { id: "t1", name: "terminal", args: ARGS, result: RESULT, status: "complete" },
      spawn,
    );
    expect(enriched.startedAt).toBe(spawn);
  });

  it("enrichMessageBackgroundTools deriva startedAt do timestamp da mensagem", () => {
    const msg: ChatMessage = {
      id: "a1",
      role: "assistant",
      content: "",
      timestamp: 1_700_000_000, // epoch em SEGUNDOS
      segments: [
        {
          kind: "tools",
          toolCalls: [
            { id: "t1", name: "terminal", args: ARGS, result: RESULT, status: "complete" },
          ],
        },
      ],
    } as ChatMessage;
    const out = enrichMessageBackgroundTools(msg);
    const tc = (out.segments ?? [])
      .flatMap((s) => (s.kind === "tools" ? s.toolCalls : []))
      .find((t) => t.id === "t1");
    expect(tc?.status).toBe("running");
    expect(tc?.startedAt).toBe(1_700_000_000 * 1000); // segundos -> ms
  });

  it("isBackgroundSpawnResult", () => {
    expect(isBackgroundSpawnResult(RESULT)).toBe(true);
    expect(isBackgroundSpawnResult("{}")).toBe(false);
  });

  it("isTerminalBackgroundArgs", () => {
    expect(isTerminalBackgroundArgs(ARGS)).toBe(true);
    expect(isTerminalBackgroundArgs("{}")).toBe(false);
  });

  it("mergeRunningBackgroundProgress preserva spawn e atualiza stdout", () => {
    const merged = JSON.parse(
      mergeRunningBackgroundProgress(
        RESULT,
        "frame=42\ndone 3 files",
        "proc_abc123",
        95,
      ),
    ) as Record<string, unknown>;
    expect(merged.uptime_seconds).toBe(95);
    expect(String(merged.output)).toContain(BACKGROUND_STARTED_OUTPUT);
    expect(String(merged.output)).toContain("done 3 files");
    expect(extractLiveBackgroundStdout(JSON.stringify(merged))).toContain(
      "done 3 files",
    );
    expect(readBackgroundUptimeSeconds(JSON.stringify(merged))).toBe(95);
    expect(formatBackgroundUptime(95)).toBe("1m 35s");
  });

  it("não ressuscita tool com background_exited", () => {
    const exited = JSON.stringify({
      session_id: "proc_abc123",
      output: `${BACKGROUND_STARTED_OUTPUT}\ndone`,
      background_exited: true,
      exit_code: 0,
    });
    expect(hasBackgroundExitedMarker(exited)).toBe(true);
    expect(isBackgroundSpawnResult(exited)).toBe(false);
    const tc: ToolCallEvent = {
      id: "t1",
      name: "terminal",
      args: ARGS,
      result: exited,
      status: "complete",
    };
    expect(enrichBackgroundRunningTool(tc)).toBe(tc);
  });

  it("spawn candidate ignora tools já finalizadas ou em running", () => {
    const msg: ChatMessage = {
      id: "a1",
      role: "assistant",
      content: "",
      timestamp: 1,
      toolCalls: [
        {
          id: "t1",
          name: "terminal",
          args: ARGS,
          result: RESULT,
          status: "complete",
          backgroundProcId: "proc_abc123",
        },
      ],
    };
    expect(messageHasBackgroundSpawnCandidate(msg)).toBe(false);
  });
});
