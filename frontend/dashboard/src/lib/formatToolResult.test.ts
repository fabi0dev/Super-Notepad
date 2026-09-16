import { describe, expect, it } from "vitest";
import {
  formatFriendlyToolResult,
  formatSkillViewCollapsedPreview,
  formatToolArgsBody,
  formatToolArgsHeadline,
  formatToolResultBody,
  formatToolResultSubtitle,
  alignToolTitleWithStatus,
  inferToolResultStatus,
  isEmptyToolArgs,
  resolveToolResultStatus,
  stripReadFileLineNumbers,
  summarizeToolArgsForDisplay,
} from "./formatToolResult";

describe("formatToolResultSubtitle", () => {
  it("resume gateway_inspect com canal pronto", () => {
    const raw = JSON.stringify({
      gateway_running: true,
      configured_keys: ["whatsapp"],
      platforms: [
        { key: "whatsapp", label: "WhatsApp", state: "paired" },
        { key: "telegram", label: "Telegram", state: "not_configured" },
      ],
    });
    expect(formatToolResultSubtitle("gateway_inspect", raw)).toBe(
      "WhatsApp conectado",
    );
  });

  it("resume gateway parado sem canais", () => {
    const raw = JSON.stringify({
      gateway_running: false,
      configured_keys: [],
      platforms: [{ key: "whatsapp", label: "WhatsApp", state: "not_configured" }],
    });
    expect(formatToolResultSubtitle("gateway_inspect", raw)).toBe(
      "Nenhum app de mensagem configurado",
    );
  });

  it("resume send_message para telegram", () => {
    const raw = JSON.stringify({ success: true, platform: "telegram" });
    expect(formatToolResultSubtitle("send_message", raw)).toBe(
      "Mensagem enviada para o Telegram",
    );
  });

  it("resume send_message para slack", () => {
    expect(
      formatToolResultSubtitle(
        "send_message",
        JSON.stringify({ success: true, platform: "slack" }),
      ),
    ).toBe("Mensagem enviada para o Slack");
  });

  it("resume gateway_inspect para telegram configurado", () => {
    const raw = JSON.stringify({
      gateway_running: true,
      platforms: [{ key: "telegram", label: "Telegram", state: "configured" }],
    });
    expect(formatToolResultSubtitle("gateway_inspect", raw)).toBe(
      "Telegram configurado",
    );
  });

  it("resume gateway_inspect parcial por canal", () => {
    expect(
      formatFriendlyToolResult(
        "gateway_inspect",
        JSON.stringify({
          gateway_running: true,
          platforms: [{ key: "slack", label: "Slack", state: "partial" }],
        }),
      )?.headline,
    ).toBe("Slack — configuração incompleta");
    expect(
      formatToolResultBody(
        "gateway_inspect",
        JSON.stringify({
          gateway_running: true,
          platforms: [{ key: "slack", label: "Slack", state: "partial" }],
        }),
      ),
    ).toBe("Abra Canais e informe o token do app Slack.");
  });

  it("resume send_message com preview da mensagem", () => {
    const raw = JSON.stringify({
      success: true,
      platform: "whatsapp",
    });
    const args = JSON.stringify({ message: "Oi", target: "whatsapp" });
    expect(formatToolResultSubtitle("send_message", raw, args)).toBe(
      "Mensagem enviada para o WhatsApp",
    );
  });

  it("resume todo com contagem", () => {
    const raw = JSON.stringify({
      todos: [],
      summary: { total: 3, pending: 2, in_progress: 1, completed: 0, cancelled: 0 },
    });
    expect(formatToolResultSubtitle("todo", raw)).toBe(
      "Tarefas em andamento",
    );
  });

  it("resume wiser com resposta do usuário", () => {
    const raw = JSON.stringify({
      question: "Remover o Android SDK?",
      choices_offered: ["Sim", "Não"],
      user_response: "Não, quero manter",
    });
    expect(formatToolResultSubtitle("wiser", raw)).toBe(
      "Resposta: Não, quero manter",
    );
  });

  it("resume wiser com timeout", () => {
    const raw = JSON.stringify({
      question: "Remover o Android SDK?",
      choices_offered: ["Sim", "Não"],
      user_response:
        "The user did not provide a response within the time limit. Use your best judgement to make the choice and proceed.",
    });
    expect(formatToolResultSubtitle("wiser", raw)).toBe("Sem resposta a tempo");
  });
});

describe("formatToolResultBody", () => {
  it("formata wiser sem JSON bruto", () => {
    const raw = JSON.stringify({
      question: "Quer remover o Android SDK (16 GB)?",
      choices_offered: ["Sim", "Não"],
      user_response:
        "The user did not provide a response within the time limit. Use your best judgement to make the choice and proceed.",
      context: "Maior consumidor restante após limpeza.",
    });
    const body = formatToolResultBody("wiser", raw);
    expect(body).toContain("Quer remover o Android SDK");
    expect(body).toContain("Opções oferecidas:");
    expect(body).toContain("Maior consumidor restante");
    expect(body).not.toContain("choices_offered");
  });

  it("formata execute_code com saída em vez de JSON bruto", () => {
    const raw = JSON.stringify({
      status: "success",
      output: "Existe: True\nTamanho: 213.4 KB\n",
      tool_calls_made: 0,
      duration_seconds: 0.21,
    });
    const args = JSON.stringify({
      code: [
        "import os",
        'path = "/Users/dev/.cache/thumb.png"',
        'print(f"Existe: {os.path.exists(path)}")',
        'print(f"Tamanho: 213.4 KB")',
      ].join("\n"),
    });
    const body = formatToolResultBody("execute_code", raw, args);
    expect(body).toContain("~/.cache/thumb.png: encontrado");
    expect(body).toContain("Tamanho · ~/.cache/thumb.png: 213.4 KB");
    expect(body).not.toContain("tool_calls_made");
    expect(body).not.toContain("Existe: True");

    const friendly = formatFriendlyToolResult("execute_code", raw, args);
    expect(friendly?.headline).toContain("Código executado");
    expect(friendly?.headline).toContain("0.21s");
    expect(friendly?.headline).not.toContain("Existe");
  });

  it("humaniza Existe sem caminho no script", () => {
    const raw = JSON.stringify({
      status: "success",
      output: "Existe: False\n",
    });
    const body = formatToolResultBody("execute_code", raw);
    expect(body).toBe("Encontrado: não");
    expect(body).not.toContain("Existe:");
  });

  it("omite outros apps quando whatsapp está pronto", () => {
    const raw = JSON.stringify({
      gateway_running: true,
      platforms: [
        { key: "whatsapp", label: "WhatsApp", state: "paired" },
        { key: "telegram", label: "Telegram", state: "not_configured" },
        { key: "slack", label: "Slack", state: "not_configured" },
      ],
      next_steps: [],
    });
    expect(formatToolResultBody("gateway_inspect", raw)).toBeNull();
  });

  it("omite corpo quando gateway_inspect não tem detalhe extra", () => {
    const raw = JSON.stringify({
      gateway_running: true,
      platforms: [{ key: "whatsapp", label: "WhatsApp", state: "paired" }],
      next_steps: [],
    });
    expect(formatToolResultBody("gateway_inspect", raw)).toBeNull();
  });

  it("mostra apenas próximos passos no gateway_inspect", () => {
    const raw = JSON.stringify({
      gateway_running: false,
      platforms: [{ key: "whatsapp", label: "WhatsApp", state: "configured" }],
      next_steps: ["Inicie o gateway em /channels."],
    });
    const body = formatToolResultBody("gateway_inspect", raw);
    expect(body).toContain("Inicie o gateway em /channels.");
    expect(body).toContain("Ligue o serviço de mensagens");
  });

  it("omite corpo em send_message bem-sucedido", () => {
    const raw = JSON.stringify({
      success: true,
      platform: "whatsapp",
      note: "Sent to whatsapp home channel (chat_id: 123@lid)",
      mirrored: true,
    });
    expect(formatToolResultBody("send_message", raw)).toBeNull();
  });

  it("formata erro de send_message no headline", () => {
    const raw = JSON.stringify({ error: "Gateway offline" });
    expect(formatFriendlyToolResult("send_message", raw)?.headline).toBe(
      "Falha ao enviar: Gateway offline",
    );
  });
});

describe("formatToolArgsHeadline", () => {
  it("envio em andamento para outros canais", () => {
    expect(
      formatToolArgsHeadline(
        "send_message",
        JSON.stringify({ target: "telegram:123", message: "Olá" }),
      ),
    ).toBe("Enviando mensagem para o Telegram");
    expect(
      formatToolArgsHeadline(
        "send_message",
        JSON.stringify({ target: "slack", message: "Olá" }),
      ),
    ).toBe("Enviando mensagem para o Slack");
  });

  it("prioriza plataforma sobre mensagem em send_message", () => {
    const args = JSON.stringify({
      target: "whatsapp",
      message: "Mande um oi no meu whats",
    });
    expect(formatToolArgsHeadline("send_message", args)).toBe(
      "Enviando mensagem para o WhatsApp",
    );
  });

  it("resume delegate_task em andamento sem JSON", () => {
    const args = JSON.stringify({
      context: "repo",
      tasks: [
        { goal: "Analise o diff destes arquivos", toolsets: ["file"] },
        { goal: "Revise a timeline do chat", toolsets: ["file"] },
      ],
    });
    expect(formatToolArgsHeadline("delegate_task", args)).toBe(
      "Delegando 2 tarefas",
    );
    expect(formatToolArgsBody("delegate_task", args)).toBe(
      "1. Analise o diff destes arquivos\n2. Revise a timeline do chat",
    );
  });

  it("resume delegate_task com uma tarefa", () => {
    const args = JSON.stringify({
      tasks: [{ goal: "Corrigir o card de delegação", toolsets: ["file"] }],
    });
    expect(formatToolArgsHeadline("delegate_task", args)).toBe(
      "Delegando: Corrigir o card de delegação",
    );
  });

  it("search_files e read_file em andamento sem JSON nos args", () => {
    const searchArgs = JSON.stringify({
      file_glob: "*.ts",
      path: "/Users/dev/proj/src/lib",
      pattern: "useDeleteUser|useDestroyUser",
    });
    expect(formatToolArgsHeadline("search_files", searchArgs)).toContain(
      "Busca: useDeleteUser|useDestroyUser",
    );
    expect(formatToolArgsBody("search_files", searchArgs)).toBe("");

    expect(
      formatToolArgsHeadline(
        "session_search",
        JSON.stringify({
          query: "pizza app OR projeto",
          limit: 5,
          session_search: "pizza app OR projeto",
        }),
      ),
    ).toBe('Na sessão: "pizza app OR projeto"');
    expect(
      formatToolArgsBody(
        "session_search",
        JSON.stringify({ query: "pizza", limit: 5 }),
      ),
    ).toBe("");

    const readArgs = JSON.stringify({
      path: "/Users/dev/proj/src/app/api/admin/users/[id]/route.ts",
    });
    expect(formatToolArgsHeadline("read_file", readArgs)).toContain("route.ts");
    expect(formatToolArgsBody("read_file", readArgs)).toBe("");
  });

  it("patch e write_file em andamento sem JSON nos args", () => {
    const patchArgs = JSON.stringify({
      path: "/Users/dev/project/src/lib/queries.ts",
      old_string: "a",
      new_string: "b",
    });
    expect(formatToolArgsHeadline("patch", patchArgs)).toContain("queries.ts");
    expect(formatToolArgsBody("patch", patchArgs)).toBe("");

    const writeArgs = JSON.stringify({
      path: "/tmp/out.ts",
      content: "hello\nworld",
    });
    expect(formatToolArgsHeadline("write_file", writeArgs)).toContain("out.ts");
    expect(formatToolArgsBody("write_file", writeArgs)).toBe("");
  });

  it("summarizeToolArgsForDisplay omite payloads volumosos", () => {
    const raw = JSON.stringify({
      path: "/tmp/x.ts",
      old_string: "lots of code\n".repeat(20),
      new_string: "more code\n".repeat(20),
      mode: "replace",
    });
    const summary = summarizeToolArgsForDisplay(raw);
    expect(summary).toContain("path:");
    expect(summary).toContain("mode: replace");
    expect(summary).not.toContain("old_string");
    expect(summary).not.toContain("lots of code");
  });
});

describe("delegate_task formatting", () => {
  it("mostra erro em vez de concluída quando há error no JSON", () => {
    const raw = JSON.stringify({
      error: "Too many tasks: 5 provided, but max_concurrent_children is 3",
      results: [],
    });
    const friendly = formatFriendlyToolResult("delegate_task", raw);
    expect(friendly?.headline).toContain("Too many tasks");
    expect(inferToolResultStatus("delegate_task", raw)).toBe("error");
    expect(
      alignToolTitleWithStatus(friendly!.headline, "error"),
    ).not.toMatch(/concluíd/i);
  });

  it("marca falha total quando todos os subagentes falharam", () => {
    const raw = JSON.stringify({
      results: [
        { task_index: 0, status: "failed", summary: "timeout" },
        { task_index: 1, status: "error", summary: "crash" },
      ],
    });
    const friendly = formatFriendlyToolResult("delegate_task", raw);
    expect(friendly?.headline).toBe("Delegação falhou (0/2)");
    expect(inferToolResultStatus("delegate_task", raw)).toBe("error");
  });

  it("trata timeout de subagente como falha total", () => {
    const raw = JSON.stringify({
      results: [{ task_index: 0, status: "timeout", summary: null }],
    });
    expect(inferToolResultStatus("delegate_task", raw)).toBe("error");
    expect(formatFriendlyToolResult("delegate_task", raw)?.headline).toBe(
      "Delegação falhou (0/1)",
    );
  });

  it("resume subagentes em vez de JSON cru", () => {
    const raw = JSON.stringify({
      results: [
        {
          task_index: 0,
          status: "completed",
          summary: "**Pizzaria Bella** - (11) 94529-4058",
        },
        {
          task_index: 1,
          status: "completed",
          summary: "**Pizzaria Roma** - (11) 99999-0000",
        },
      ],
      total_duration_seconds: 13.14,
    });
    const friendly = formatFriendlyToolResult("delegate_task", raw);
    expect(friendly?.headline).toBe("2 subagentes concluídos");
    expect(friendly?.detail).toContain("Pizzaria Bella");
    expect(formatToolResultBody("delegate_task", raw)).toContain("Pizzaria Roma");
  });
});

describe("resolveToolResultStatus", () => {
  it("usa traceback como erro", () => {
    const raw =
      'Traceback (most recent call last):\nValueError: bad';
    expect(resolveToolResultStatus("execute_code", raw, "complete")).toBe(
      "error",
    );
  });
});

describe("inferToolResultStatus", () => {
  it("marca navegação do browser como erro", () => {
    expect(
      inferToolResultStatus(
        "browser_navigate",
        "Navigation failed: net::ERR_NAME_NOT_RESOLVED",
      ),
    ).toBe("error");
  });

  it("marca traceback de execute_code como erro", () => {
    expect(
      inferToolResultStatus(
        "execute_code",
        "Traceback (most recent call last):\n  File \"script.py\", line 1\nValueError: x",
      ),
    ).toBe("error");
  });

  it("trata skill_view de outro workspace como suave (não erro)", () => {
    expect(
      inferToolResultStatus(
        "skill_view",
        JSON.stringify({
          success: true,
          skipped: true,
          workspace_mismatch: true,
          message: "Skill não disponível neste workspace/projeto.",
        }),
      ),
    ).toBe("complete");
  });
});

describe("plain tool failures", () => {
  it("formata traceback sem mostrar JSON", () => {
    const raw =
      'Traceback (most recent call last):\n  File "script.py", line 1\nNameError: name "x" is not defined';
    const friendly = formatFriendlyToolResult("execute_code", raw);
    expect(friendly?.headline).toContain("NameError");
    expect(friendly?.detail).toContain("Traceback");
  });
});

describe("isEmptyToolArgs", () => {
  it("detecta args vazios", () => {
    expect(isEmptyToolArgs("{}")).toBe(true);
    expect(isEmptyToolArgs('{"path":"x"}')).toBe(false);
    expect(isEmptyToolArgs("")).toBe(true);
  });
});

describe("terminal tool", () => {
  it("resume comando com descrição e saída curta", () => {
    const raw = JSON.stringify({ output: "Porta 3000 liberada\n", exit_code: 0 });
    const args = JSON.stringify({
      description: "Matando processo na porta 3000",
      command: "lsof -ti:3000 | xargs kill -9",
    });
    const friendly = formatFriendlyToolResult("terminal", raw, args);
    expect(friendly?.headline).toContain("Matando processo");
  });

  it("mostra executando em segundo plano para spawn background", () => {
    const raw = JSON.stringify({
      output: "Background process started",
      session_id: "proc_abc",
      exit_code: 0,
    });
    const args = JSON.stringify({
      background: true,
      description: "Build APK staging",
      command: "./gradlew assembleStagingRelease",
    });
    const friendly = formatFriendlyToolResult("terminal", raw, args);
    expect(friendly?.headline).toContain("segundo plano");
    expect(friendly?.headline).toContain("Build APK staging");
  });
});

describe("process tool", () => {
  it("humaniza processo não encontrado (legado em inglês)", () => {
    const raw = JSON.stringify({
      status: "not_found",
      error: "No process with ID proc_17bb27a065ee",
    });
    const friendly = formatFriendlyToolResult(
      "process",
      raw,
      JSON.stringify({ action: "kill", session_id: "proc_17bb27a065ee" }),
    );
    expect(friendly?.headline).toContain("Processo em segundo plano não encontrado");
    expect(friendly?.headline).toContain("proc_17bb27a065ee");
    expect(friendly?.headline).not.toContain("No process with ID");
    expect(inferToolResultStatus("process", raw)).toBe("error");
  });

  it("resume kill bem-sucedido", () => {
    const raw = JSON.stringify({ status: "killed", session_id: "proc_abc" });
    expect(formatToolResultSubtitle("process", raw)).toBe("Processo encerrado");
    expect(inferToolResultStatus("process", raw)).toBe("complete");
  });

  it("resume processo já encerrado no kill", () => {
    const raw = JSON.stringify({ status: "already_exited", exit_code: 0 });
    expect(
      formatFriendlyToolResult(
        "process",
        raw,
        JSON.stringify({ action: "kill" }),
      )?.headline,
    ).toBe("Processo já estava encerrado");
  });
});

describe("inferToolResultStatus terminal failures", () => {
  it("marca exit 130 como erro", () => {
    const raw = JSON.stringify({
      output: "partial\n[Command interrupted]",
      exit_code: 130,
      error: null,
    });
    expect(inferToolResultStatus("terminal", raw)).toBe("error");
  });

  it("marca execute_code interrupted como erro", () => {
    const raw = JSON.stringify({ status: "interrupted", output: "stopped" });
    expect(inferToolResultStatus("execute_code", raw)).toBe("error");
  });

  it("não marca JSON de sucesso por palavra failed no output", () => {
    const raw = JSON.stringify({
      status: "success",
      output: "Auto-launch failed: Chrome not found\nExiste: True\n",
      tool_calls_made: 0,
    });
    expect(inferToolResultStatus("execute_code", raw)).toBe("complete");
  });
});

describe("formatToolResultBody read_file", () => {
  it("extrai content sem JSON e remove LINE_NUM|", () => {
    const raw = JSON.stringify({
      content: "     1|import React from \"react\";\n     2|export const X = 1;\n",
      total_lines: 2,
      file_size: 40,
      truncated: false,
      is_binary: false,
    });
    const body = formatToolResultBody("read_file", raw);
    expect(body).toBe('import React from "react";\nexport const X = 1;');
    expect(body).not.toContain("total_lines");
    expect(body).not.toContain('"content"');
  });

  it("resume erro e binário sem detalhe de arquivo", () => {
    expect(
      formatToolResultSubtitle(
        "read_file",
        JSON.stringify({ error: "File not found", path: "/tmp/x" }),
      ),
    ).toBeTruthy();
    expect(
      formatToolResultBody(
        "read_file",
        JSON.stringify({
          is_binary: true,
          file_size: 10,
          error: "Binary file - cannot display as text.",
        }),
      ),
    ).toBeNull();
  });

  it("resume dedup unchanged", () => {
    expect(
      formatToolResultSubtitle(
        "read_file",
        JSON.stringify({
          status: "unchanged",
          message: "Arquivo não mudou desde a última leitura",
          path: "/tmp/a.ts",
          dedup: true,
          content_returned: false,
        }),
      ),
    ).toContain("não mudou");
  });
});

describe("stripReadFileLineNumbers", () => {
  it("remove prefixos numerados", () => {
    expect(stripReadFileLineNumbers("     1|foo\n    12|bar")).toBe("foo\nbar");
  });
});

describe("formatToolResultBody patch/write_file", () => {
  it("extrai diff unificado sem JSON nem files_modified", () => {
    const diff = [
      "--- a/route.ts",
      "+++ b/route.ts",
      "@@ -1,3 +1,4 @@",
      " import x from 'x';",
      "+import y from 'y';",
      " export const z = 1;",
    ].join("\n");
    const raw = JSON.stringify({
      success: true,
      diff,
      files_modified: [
        "/Users/dev/Documents/develop-personal/sn-online/route.ts",
      ],
      lint: {
        status: "error",
        output: "route.ts(10,1): error TS2307: Cannot find module '@lib/admin'",
      },
    });
    const body = formatToolResultBody("patch", raw);
    expect(body).toContain("--- a/route.ts");
    expect(body).toContain("+import y from 'y';");
    expect(body).toContain("── Lint ──");
    expect(body).toContain("TS2307");
    expect(body).not.toContain("files_modified");
    expect(body).not.toContain('"success"');
    expect(body).not.toContain("\\n");
  });

  it("write_file bem-sucedido não devolve JSON", () => {
    const raw = JSON.stringify({ bytes_written: 120, dirs_created: false });
    expect(formatToolResultBody("write_file", raw)).toBeNull();
    expect(formatFriendlyToolResult("write_file", raw)).toEqual({
      headline: "",
      detail: "",
    });
  });
});

describe("skill_view tool", () => {
  const sampleResult = JSON.stringify({
    success: true,
    name: "git-commit-push-workflow",
    description:
      "Fluxo completo de commit e push no Git — criar branch, stage, commit com mensagem descritiva e trailer Co-authored-by, push.",
    tags: ["devops", "git"],
    related_skills: ["git-branch-workflow"],
    path: "optional-skills/devops/git-commit-push-workflow",
    linked_files: {
      references: ["references/commit-template.md"],
      scripts: ["scripts/verify.sh"],
    },
    content: "---\nname: git-commit-push-workflow\n---\n\n# Git commit\n",
    setup_needed: false,
    usage_hint: "Use skill_view(name, file_path) para arquivos vinculados.",
  });

  it("resume com nome HUMANIZADO e descrição no preview", () => {
    const preview = formatSkillViewCollapsedPreview(sampleResult);
    // Nome legível (sentence-case, sem hífens), nunca o slug cru.
    expect(preview).toContain("Git commit push workflow");
    expect(preview).not.toContain("git-commit-push-workflow");
    expect(preview).toContain("Fluxo completo de commit e push");
    expect(preview).not.toContain('"tags"');
    expect(preview).not.toContain("references/commit-template");
  });

  it("detalha tags, arquivos e conteúdo ao expandir", () => {
    const friendly = formatFriendlyToolResult("skill_view", sampleResult);
    expect(friendly?.headline).toBe("Git commit push workflow");
    expect(friendly?.detail).toContain("Tags");
    expect(friendly?.detail).toContain("devops, git");
    expect(friendly?.detail).toContain("references/commit-template.md");
    expect(friendly?.detail).toContain("# Git commit");
    expect(friendly?.detail).not.toContain('"success"');
  });
});

describe("browser tools", () => {
  it("browser_snapshot mostra erro Chrome amigável", () => {
    const raw = JSON.stringify({
      success: false,
      error: "Failed to take screenshot: Chrome executable not found",
    });
    const friendly = formatFriendlyToolResult("browser_snapshot", raw);
    expect(friendly?.headline).toMatch(/Chrome/i);
    expect(friendly?.detail).toBe("");
    expect(friendly?.headline).not.toContain("{");
  });

  it("browser_navigate mostra URL no sucesso", () => {
    const raw = JSON.stringify({ success: true, url: "https://example.com" });
    const friendly = formatFriendlyToolResult("browser_navigate", raw);
    expect(friendly?.headline).toContain("https://example.com");
  });
});

describe("search_files e terminal expand", () => {
  it("search_files resume matches sem JSON no título", () => {
    const raw = JSON.stringify({
      pattern: "foo",
      path: "/tmp/proj",
      matches: [{ path: "/tmp/proj/a.ts", line: 1, content: "foo bar" }],
      total_count: 1,
    });
    const friendly = formatFriendlyToolResult("search_files", raw);
    expect(friendly?.headline).toMatch(/1 resultado/);
    expect(friendly?.headline).not.toContain("{");
    expect(friendly?.detail).toContain("a.ts");
  });

  it("terminal preserva saída completa no detail", () => {
    const lines = Array.from(
      { length: 50 },
      (_, i) => `line-${i}-${"x".repeat(20)}`,
    ).join("\n");
    const raw = JSON.stringify({ exit_code: 0, output: lines });
    const friendly = formatFriendlyToolResult("terminal", raw);
    expect(friendly?.detail).toBe(lines);
    expect((friendly?.detail ?? "").length).toBeGreaterThan(400);
  });

  it("memory recall mostra busca, não atualização", () => {
    expect(
      formatToolArgsHeadline(
        "memory",
        JSON.stringify({ action: "recall", query: "preferência de café" }),
      ),
    ).toBe('Buscando na memória: "preferência de café"');
    expect(
      formatToolArgsHeadline(
        "memory",
        JSON.stringify({ action: "recall", tag: "eu" }),
      ),
    ).toBe("Buscando na memória: #eu");
    expect(
      formatToolArgsHeadline(
        "memory",
        JSON.stringify({
          action: "add",
          content: "Prefiro respostas curtas #eu",
        }),
      ),
    ).toContain("Gravando memória");
  });

  it("memory recall lista títulos no card, não o JSON cru", () => {
    const raw = JSON.stringify({
      query: "deploy",
      count: 2,
      entries: [
        { title: "Deploy na Vercel", content: "Roda na Vercel #infra" },
        { preview: "Build quebra sem NODE_VERSION" },
      ],
      related_tags: ["infra", "ci"],
    });
    const friendly = formatFriendlyToolResult("memory", raw);
    expect(friendly?.headline).toBe("2 memórias encontradas");
    expect(friendly?.detail).toContain("Deploy na Vercel");
    expect(friendly?.detail).toContain("Build quebra sem NODE_VERSION");
    expect(friendly?.detail).toContain("#infra");
  });
});

describe("guardrail errors no card do chat", () => {
  it("não mostra 'reemita' nem o nome da tool", () => {
    const raw =
      JSON.stringify({
        error:
          "Argumentos inválidos para `reminder_add`: falta `text`. Reemita a chamada com os parâmetros corretos — não invente o resultado.",
      }) + "\n\n[Sistema: restam ~7 iterações.]";
    const subtitle = formatToolResultSubtitle("reminder_add", raw);
    expect(subtitle).toBe("Faltou um dado obrigatório");
    expect(subtitle).not.toMatch(/Reemita|reminder_add|invente/);
    expect(inferToolResultStatus("reminder_add", raw)).toBe("error");
  });

  it("bloqueio de modo fala Início/Code, não o nome da ferramenta", () => {
    const raw = JSON.stringify({
      error: "`terminal` não está disponível no modo inicio. Não executei.",
    });
    expect(formatToolResultSubtitle("terminal", raw)).toBe(
      "Essa ação não está disponível no modo Início",
    );
  });
});
