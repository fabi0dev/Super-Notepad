import { describe, expect, it } from "vitest";
import {
  classifyToolOutcome,
  humanizeKnownToolError,
  inferToolFailed,
  inferToolResultStatus,
  isFileStateGuardMessage,
  isToolCancelled,
  isToolFailureBlocking,
  toolFailureSummary,
} from "./toolOutcome";
import type { ToolOutcomeInput } from "./toolOutcome";

describe("toolOutcome", () => {
  it("humaniza avisos de file_state e marca como guard", () => {
    const msg =
      "/Users/dev/x/.gitignore was last read with offset/limit pagination (partial view). Re-read the whole file before overwriting it.";
    expect(isFileStateGuardMessage(msg)).toBe(true);
    expect(humanizeKnownToolError(msg)).toMatch(/leitura parcial/i);
    expect(humanizeKnownToolError(msg)).not.toMatch(/offset/i);
  });
  it("não marca falha quando JSON success contém 'failed' no output", () => {
    const raw = JSON.stringify({
      status: "success",
      output: "Auto-launch failed earlier but file exists: True\n",
    });
    expect(inferToolFailed("execute_code", raw)).toBe(false);
    expect(inferToolResultStatus("execute_code", raw)).toBe("complete");
  });

  it("classifica browser_snapshot falho + execute_code ok como falha opcional não bloqueante", () => {
    const browser: ToolOutcomeInput = {
      name: "browser_snapshot",
      status: "error",
      result: JSON.stringify({
        success: false,
        error: "Failed to take screenshot: Chrome not found",
      }),
    };
    const script: ToolOutcomeInput = {
      name: "execute_code",
      status: "complete",
      result: JSON.stringify({ status: "success", output: "ok\n" }),
    };
    const turn = [browser, script];

    expect(classifyToolOutcome(browser)).toBe("failed");
    expect(classifyToolOutcome(script)).toBe("completed");
    expect(isToolFailureBlocking(browser, turn)).toBe(false);
    expect(isToolFailureBlocking(script, turn)).toBe(false);
  });

  it("terminal com exit_code != 0 é bloqueante", () => {
    const terminal: ToolOutcomeInput = {
      name: "terminal",
      result: JSON.stringify({ exit_code: 1, output: "permission denied" }),
    };
    expect(isToolFailureBlocking(terminal, [terminal])).toBe(true);
    expect(toolFailureSummary(terminal)).toMatch(/código 1/);
  });

  it("detecta traceback em texto puro", () => {
    const raw = "Traceback (most recent call last):\nValueError: x";
    expect(inferToolFailed("execute_code", raw)).toBe(true);
  });

  it("não marca read_file como falha quando o arquivo cita marcadores de erro", () => {
    const src = `const COMMAND_INTERRUPTED_MARKER = "[Command interrupted]";\nconst hint = /permission denied/i;\n`;
    const numbered = src
      .split(/\r?\n/)
      .map((line, index) => `     ${index + 1}|${line}`)
      .join("\n");
    const raw = JSON.stringify({ content: numbered, is_binary: false });
    expect(inferToolFailed("read_file", raw)).toBe(false);
    expect(inferToolResultStatus("read_file", raw)).toBe("complete");
  });

  it("process wait com exit_code != 0 é falha", () => {
    const raw = JSON.stringify({ status: "exited", exit_code: 1, output: "fail" });
    expect(inferToolFailed("process", raw)).toBe(true);
    expect(toolFailureSummary({ name: "process", result: raw })).toMatch(
      /código 1/,
    );
  });

  it("process exited com exit_code 0 não é falha", () => {
    const raw = JSON.stringify({ status: "exited", exit_code: 0 });
    expect(inferToolFailed("process", raw)).toBe(false);
  });

  it("cancelamento explícito não é falha estrutural", () => {
    const raw = "[Tool execution cancelled by user]";
    expect(inferToolFailed("terminal", raw)).toBe(false);
    expect(isToolCancelled(raw)).toBe(true);
    expect(classifyToolOutcome({ name: "terminal", result: raw })).toBe(
      "cancelled",
    );
  });

  it("status error sem resultado classifica como failed", () => {
    expect(
      classifyToolOutcome({ name: "terminal", status: "error", result: "" }),
    ).toBe("failed");
  });

  it("erro de schema com nota do loop continua falha e some o jargão do modelo", () => {
    const modelFacing =
      "Argumentos inválidos para `reminder_add`: falta `text`. Reemita a chamada com os parâmetros corretos — não invente o resultado.";
    const raw =
      JSON.stringify({
        error: modelFacing,
        expected_params: { required: ["text"] },
      }) + "\n\n[Sistema: restam ~7 iterações de ferramenta neste turno.]";
    expect(inferToolFailed("reminder_add", raw)).toBe(true);
    expect(inferToolResultStatus("reminder_add", raw)).toBe("error");
    expect(humanizeKnownToolError(modelFacing)).toBe("Faltou um dado obrigatório");
    expect(humanizeKnownToolError(modelFacing)).not.toMatch(
      /Reemita|invente|reminder_add/,
    );
  });

  it("bloqueio de modo não mostra o nome cru da tool", () => {
    const msg = "`terminal` não está disponível no modo inicio. Não executei.";
    expect(humanizeKnownToolError(msg)).toBe(
      "Essa ação não está disponível no modo Início",
    );
    expect(humanizeKnownToolError(msg)).not.toMatch(/terminal|Não executei/);
  });
});
