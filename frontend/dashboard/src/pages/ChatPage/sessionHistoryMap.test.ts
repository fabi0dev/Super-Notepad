import { describe, expect, it } from "vitest";
import type { SessionMessage } from "@/lib/api";
import { composeAssistantContent } from "./chatTurnSegments";
import {
  coalesceAssistantTurns,
  mapSessionMessagesToChatMessages,
  mergeMessageAttachments,
  mergeToolCallLists,
  preferRicherAssistantTurn,
  reconcileHistory,
} from "./sessionHistoryMap";
import type { ChatMessage } from "./components/types";

describe("mapSessionMessagesToChatMessages", () => {
  it("decodifica entidades HTML no texto do assistente", () => {
    const raw: SessionMessage[] = [
      { role: "user", content: "oi" },
      { role: "assistant", content: "Disse &quot;olá&quot; ao usuário." },
    ];
    const mapped = mapSessionMessagesToChatMessages(raw);
    expect(mapped[1]?.content).toBe('Disse "olá" ao usuário.');
  });

  it("não funde turnos assistant separados por tempo (gap vertical)", () => {
    const raw: SessionMessage[] = [
      {
        role: "assistant",
        content: "Protocolo concluído.",
        timestamp: 1_700_000_000,
      },
      {
        role: "assistant",
        content: "Bom dia, Fábio.",
        // ~2h depois (segundos epoch)
        timestamp: 1_700_007_200,
      },
    ];
    const mapped = mapSessionMessagesToChatMessages(raw);
    const assistants = mapped.filter((m) => m.role === "assistant");
    expect(assistants).toHaveLength(2);
    expect(assistants[0]?.content).toContain("Protocolo concluído");
    expect(assistants[1]?.content).toContain("Bom dia");
  });

  it("intercala texto e tools na ordem do histórico da sessão", () => {
    const raw: SessionMessage[] = [
      { role: "user", content: "pesquisa" },
      { role: "assistant", content: "Vou buscar agora." },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "tc-1",
            function: {
              name: "web_search",
              arguments: JSON.stringify({ query: "pizzarias" }),
            },
          },
        ],
      },
      {
        role: "tool",
        content: JSON.stringify({ data: [] }),
        tool_call_id: "tc-1",
        tool_name: "web_search",
      },
      { role: "assistant", content: "Encontrei três opções." },
    ];

    const mapped = mapSessionMessagesToChatMessages(raw);
    const turn = mapped.find((m) => m.role === "assistant");
    expect(turn?.segments?.map((segment) => segment.kind)).toEqual([
      "text",
      "tools",
      "text",
    ]);
    expect(composeAssistantContent(turn?.segments ?? [])).toContain(
      "Vou buscar",
    );
    expect(composeAssistantContent(turn?.segments ?? [])).toContain(
      "Encontrei três",
    );
  });

  it("merges consecutive assistant rows into one turn with uniform tool spacing", () => {
    const raw: SessionMessage[] = [
      { role: "user", content: "commit" },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "tc-1",
            function: {
              name: "terminal",
              arguments: JSON.stringify({
                command: "git status",
                description: "Verificando status",
              }),
            },
          },
        ],
      },
      { role: "tool", content: "ok", tool_call_id: "tc-1", tool_name: "terminal" },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "tc-2",
            function: {
              name: "terminal",
              arguments: JSON.stringify({
                command: "git commit",
                description: "Commit com trailer",
              }),
            },
          },
        ],
      },
      {
        role: "assistant",
        content: "Entendi bem as mudanças.",
      },
    ];

    const mapped = mapSessionMessagesToChatMessages(raw);
    const assistantTurns = mapped.filter((m) => m.role === "assistant");
    expect(assistantTurns).toHaveLength(1);
    expect(assistantTurns[0].toolCalls).toHaveLength(2);
    expect(assistantTurns[0].toolCalls?.[0].args).toContain("Verificando");
    expect(assistantTurns[0].content).toContain("Entendi bem");
  });

  it("maps persisted image attachments on user messages", () => {
    const raw: SessionMessage[] = [
      {
        role: "user",
        content: "O que você vê?",
        attachments: [
          {
            id: "stored-0-web_x.png",
            name: "web_x.png",
            url: "/api/chat/images/web_x.png",
          },
        ],
      },
    ];

    const mapped = mapSessionMessagesToChatMessages(raw);
    expect(mapped).toHaveLength(1);
    expect(mapped[0].attachments).toHaveLength(1);
    expect(mapped[0].attachments?.[0].url).toBe("/api/chat/images/web_x.png");
    expect(mapped[0].attachments?.[0].kind).toBe("image");
    expect(mapped[0].content).toBe("O que você vê?");
  });

  it("maps persisted document attachments on user messages", () => {
    const raw: SessionMessage[] = [
      {
        role: "user",
        content: "Leia este PDF",
        attachments: [
          {
            id: "stored-0-report.pdf",
            name: "report.pdf",
            url: "/api/chat/documents/report.pdf",
          },
        ],
      },
    ];

    const mapped = mapSessionMessagesToChatMessages(raw);
    expect(mapped).toHaveLength(1);
    expect(mapped[0].attachments).toHaveLength(1);
    expect(mapped[0].attachments?.[0].kind).toBe("document");
  });

  it("keeps the latest timestamp when merging tool and assistant rows", () => {
    const raw: SessionMessage[] = [
      { role: "user", content: "run", timestamp: 100 },
      {
        role: "assistant",
        content: "Working…",
        timestamp: 105,
      },
      {
        role: "tool",
        content: "ok",
        tool_call_id: "tc-1",
        tool_name: "terminal",
        timestamp: 130,
      },
      { role: "assistant", content: "Done.", timestamp: 145 },
    ];

    const mapped = mapSessionMessagesToChatMessages(raw);
    const assistant = mapped.find((m) => m.role === "assistant");
    expect(assistant?.timestamp).toBe(145);
  });
});

describe("raciocínio persistido aparece ao reabrir", () => {
  // O banco guarda o raciocínio por linha; sem mapeá-lo, o "Pensou" só
  // existia enquanto o cache local do navegador durasse — um navegador limpo
  // reabria a conversa sem raciocínio nenhum.
  it("mapeia reasoning do histórico para um segmento", () => {
    const raw = [
      { role: "user", content: "Quanto é 17 × 23?", timestamp: 1 },
      {
        role: "assistant",
        content: "391",
        timestamp: 2,
        reasoning: "O usuário pediu 17 × 23. 17 × 23 = 391.",
        reasoning_content: "O usuário pediu 17 × 23. 17 × 23 = 391.",
      },
    ] as unknown as SessionMessage[];

    const mapped = mapSessionMessagesToChatMessages(raw);
    const assistant = mapped.find((m) => m.role === "assistant");
    const seg = assistant?.segments?.find((s) => s.kind === "reasoning");

    expect(seg?.kind).toBe("reasoning");
    expect(seg && "content" in seg ? seg.content : "").toContain("17 × 23 = 391");
    // O raciocínio vem antes da resposta no turno.
    expect(assistant?.segments?.[0]?.kind).toBe("reasoning");
    // E não vaza para o texto visível.
    expect(assistant?.content).toBe("391");
  });

  it("linha só de raciocínio não é descartada", () => {
    const raw = [
      { role: "user", content: "oi", timestamp: 1 },
      { role: "assistant", content: "", timestamp: 2, reasoning: "pensei nisso" },
      { role: "assistant", content: "resposta", timestamp: 3 },
    ] as unknown as SessionMessage[];

    const mapped = mapSessionMessagesToChatMessages(raw);
    const assistant = mapped.find((m) => m.role === "assistant");

    expect(assistant?.segments?.some((s) => s.kind === "reasoning")).toBe(true);
    expect(assistant?.content).toBe("resposta");
  });

  it("cache vivo com duração vence o reasoning sem duração do histórico", () => {
    // Durante a sessão o cache tem timestamps reais ("Pensou por 2s"); o
    // histórico não guarda duração. O sync não pode rebaixar um pelo outro,
    // nem duplicar a linha de raciocínio.
    const cached: ChatMessage = {
      id: "c1",
      role: "assistant",
      content: "391",
      segments: [
        { kind: "reasoning", id: "live-1", content: "pensei", startedAt: 1000, endedAt: 3000 },
        { kind: "text", content: "391" },
      ],
    };
    const api: ChatMessage = {
      id: "a1",
      role: "assistant",
      content: "391",
      segments: [
        { kind: "reasoning", id: "history-reasoning-1", content: "pensei", startedAt: 2000, endedAt: 2000 },
        { kind: "text", content: "391" },
      ],
    };

    const merged = preferRicherAssistantTurn(cached, api);
    const reasoning = (merged.segments ?? []).filter((s) => s.kind === "reasoning");

    expect(reasoning).toHaveLength(1);
    expect(reasoning[0] && "id" in reasoning[0] ? reasoning[0].id : "").toBe("live-1");
  });

  it("sem reasoning no histórico, nada muda", () => {
    const raw = [
      { role: "user", content: "oi", timestamp: 1 },
      { role: "assistant", content: "olá!", timestamp: 2 },
    ] as unknown as SessionMessage[];

    const mapped = mapSessionMessagesToChatMessages(raw);
    const assistant = mapped.find((m) => m.role === "assistant");

    expect(assistant?.segments?.some((s) => s.kind === "reasoning")).toBeFalsy();
    expect(assistant?.content).toBe("olá!");
  });
});

describe("mergeToolCallLists", () => {
  it("preserves local error status when API snapshot is still complete", () => {
    const existing = [
      {
        id: "tc-1",
        name: "terminal",
        args: "rm -rf ./tmp",
        status: "error" as const,
        result: JSON.stringify({
          success: false,
          error: "Comando negado pelo usuário.",
        }),
      },
    ];
    const incoming = [
      {
        id: "tc-1",
        name: "terminal",
        args: "",
        status: "complete" as const,
      },
    ];

    const merged = mergeToolCallLists(existing, incoming);
    expect(merged[0].status).toBe("error");
    expect(merged[0].result).toContain("negado");
  });

  it("prefers richer JSON args over plain preview text", () => {
    const existing = [
      {
        id: "tc-1",
        name: "terminal",
        args: "Conferindo diretório atual",
        status: "running" as const,
      },
    ];
    const incoming = [
      {
        id: "tc-1",
        name: "terminal",
        args: JSON.stringify({
          description: "Conferindo diretório atual",
          command: "pwd",
        }),
        status: "running" as const,
      },
    ];

    const merged = mergeToolCallLists(existing, incoming);
    expect(merged[0].args).toContain("pwd");
    expect(merged[0].args).toContain("description");
  });
});

describe("preferRicherAssistantTurn", () => {
  it("preserva segmentos intercalados do cache quando conteúdo coincide", () => {
    const cached: ChatMessage = {
      id: "a1",
      role: "assistant",
      content: "Antes.\n\nDepois.",
      segments: [
        { kind: "text", content: "Antes." },
        {
          kind: "tools",
          toolCalls: [
            {
              id: "tc-1",
              name: "terminal",
              args: "{}",
              status: "complete",
            },
          ],
        },
        { kind: "text", content: "Depois." },
      ],
    };
    const fromApi: ChatMessage = {
      id: "a1-api",
      role: "assistant",
      content: "Antes.\n\nDepois.",
      segments: [
        { kind: "text", content: "Antes.\n\nDepois." },
        {
          kind: "tools",
          toolCalls: [
            {
              id: "tc-1",
              name: "terminal",
              args: "{}",
              status: "complete",
            },
          ],
        },
      ],
    };

    const merged = preferRicherAssistantTurn(cached, fromApi);
    expect(merged.segments?.map((segment) => segment.kind)).toEqual([
      "text",
      "tools",
      "text",
    ]);
    expect(merged.id).toBe("a1");
  });

  it("preserves later client completion timestamp over stale API seconds", () => {
    const cached: ChatMessage = {
      id: "a1",
      role: "assistant",
      content: "Pronto.",
      timestamp: 1_700_000_045_000,
      turnCompletedAt: 1_700_000_045_000,
    };
    const fromApi: ChatMessage = {
      id: "a1-api",
      role: "assistant",
      content: "Pronto.",
      timestamp: 1_700_000_000,
    };

    const merged = preferRicherAssistantTurn(cached, fromApi);
    expect(merged.turnCompletedAt).toBe(1_700_000_045_000);
    expect(merged.timestamp).toBe(1_700_000_045_000);
  });

  it("preserva fases Pensou do cache quando a API omite reasoning", () => {
    const cached: ChatMessage = {
      id: "a1",
      role: "assistant",
      content: "Pronto.",
      turnCompletedAt: 1_700_000_045_000,
      reasoning: {
        content: "Vou editar o arquivo.",
        startedAt: 1_700_000_000_000,
        endedAt: 1_700_000_003_000,
        streaming: false,
      },
      segments: [
        {
          kind: "reasoning",
          id: "r1",
          content: "Vou editar o arquivo.",
          startedAt: 1_700_000_000_000,
          endedAt: 1_700_000_003_000,
          streaming: false,
        },
        {
          kind: "tools",
          toolCalls: [
            {
              id: "tc-1",
              name: "write_file",
              args: "{}",
              status: "complete",
            },
          ],
        },
        { kind: "text", content: "Pronto." },
      ],
    };
    const fromApi: ChatMessage = {
      id: "a1-api",
      role: "assistant",
      content: "Pronto.",
      segments: [
        {
          kind: "tools",
          toolCalls: [
            {
              id: "tc-1",
              name: "write_file",
              args: "{}",
              status: "complete",
            },
          ],
        },
        { kind: "text", content: "Pronto." },
      ],
    };

    const merged = preferRicherAssistantTurn(cached, fromApi);
    expect(merged.segments?.some((s) => s.kind === "reasoning")).toBe(true);
    expect(merged.reasoning?.content).toBe("Vou editar o arquivo.");
  });

  it("recupera texto da API quando o cache só tem Pensou", () => {
    const answer = "Oi, Chefe! Em que posso te ajudar?";
    const cached: ChatMessage = {
      id: "a1",
      role: "assistant",
      content: "",
      turnCompletedAt: 1_700_000_045_000,
      reasoning: {
        content: "Vou responder de forma cordial.",
        startedAt: 1_700_000_000_000,
        endedAt: 1_700_000_001_000,
        streaming: false,
      },
      segments: [
        {
          kind: "reasoning",
          id: "r1",
          content: "Vou responder de forma cordial.",
          startedAt: 1_700_000_000_000,
          endedAt: 1_700_000_001_000,
          streaming: false,
        },
      ],
    };
    const fromApi: ChatMessage = {
      id: "a1-api",
      role: "assistant",
      content: answer,
      segments: [{ kind: "text", content: answer }],
    };

    const merged = preferRicherAssistantTurn(cached, fromApi);
    expect(merged.segments?.map((s) => s.kind)).toEqual(["reasoning", "text"]);
    expect(merged.segments?.find((s) => s.kind === "text")).toEqual({
      kind: "text",
      content: answer,
    });
    expect(merged.content).toBe(answer);
    expect(merged.reasoning?.content).toBe("Vou responder de forma cordial.");
  });
});

describe("reconcileHistory", () => {
  it("keeps API image attachments when cache dropped blob previews", () => {
    const cached: ChatMessage[] = [
      { id: "u1", role: "user", content: "Olá", timestamp: 1 },
      { id: "a1", role: "assistant", content: "Oi", timestamp: 2 },
    ];
    const fromApi: ChatMessage[] = [
      {
        id: "u1-api",
        role: "user",
        content: "Olá",
        timestamp: 1,
        attachments: [
          {
            id: "stored-0-web_x.png",
            name: "web_x.png",
            kind: "image",
            url: "/api/chat/images/web_x.png",
            previewUrl: "/api/chat/images/web_x.png",
          },
        ],
      },
      { id: "a1-api", role: "assistant", content: "Oi", timestamp: 2 },
    ];

    const merged = reconcileHistory(cached, fromApi);
    expect(merged[0].attachments).toHaveLength(1);
    expect(merged[0].attachments?.[0].url).toBe("/api/chat/images/web_x.png");
    expect(merged[0].id).toBe("u1");
    expect(merged[1].id).toBe("a1");
  });

  it("preserva ids do cache em polls repetidos com conteúdo igual", () => {
    const cached: ChatMessage[] = [
      { id: "local-u", role: "user", content: "Olá", timestamp: 1 },
      {
        id: "local-a",
        role: "assistant",
        content: "Resposta longa para selecionar.",
        timestamp: 2,
        turnCompletedAt: 2,
      },
    ];
    const fromApi: ChatMessage[] = [
      { id: "api-u-random", role: "user", content: "Olá", timestamp: 1 },
      {
        id: "api-a-random",
        role: "assistant",
        content: "Resposta longa para selecionar.",
        timestamp: 2,
      },
    ];

    const first = reconcileHistory(cached, fromApi);
    const second = reconcileHistory(first, fromApi);
    expect(first.map((m) => m.id)).toEqual(["local-u", "local-a"]);
    expect(second.map((m) => m.id)).toEqual(["local-u", "local-a"]);
  });

  it("mapeia histórico com ids determinísticos entre polls", () => {
    const raw = [
      { role: "user" as const, content: "hi", timestamp: 10 },
      { role: "assistant" as const, content: "hello", timestamp: 20 },
    ];
    const a = mapSessionMessagesToChatMessages(raw);
    const b = mapSessionMessagesToChatMessages(raw);
    expect(a.map((m) => m.id)).toEqual(b.map((m) => m.id));
    expect(a[0].id).toBe("user-0-10");
    expect(a[1].id).toBe("assistant-1-20");
  });

  it("does not truncate longer local history with shorter API snapshot", () => {
    const cached: ChatMessage[] = [
      { id: "u1", role: "user", content: "first", timestamp: 1 },
      { id: "a1", role: "assistant", content: "reply", timestamp: 2 },
      { id: "u2", role: "user", content: "second", timestamp: 3 },
      { id: "a2", role: "assistant", content: "streaming…", timestamp: 4 },
    ];
    const fromApi: ChatMessage[] = [
      { id: "u1-api", role: "user", content: "first", timestamp: 1 },
      { id: "a1-api", role: "assistant", content: "reply", timestamp: 2 },
    ];

    const merged = reconcileHistory(cached, fromApi);
    expect(merged.length).toBeGreaterThanOrEqual(cached.length);
    expect(merged.some((m) => m.content === "second")).toBe(true);
  });
});

describe("mergeMessageAttachments", () => {
  it("prefers API attachments over empty local rows", () => {
    const base: ChatMessage[] = [
      { id: "u1", role: "user", content: "Foto", timestamp: 1 },
    ];
    const rich: ChatMessage[] = [
      {
        id: "u1-api",
        role: "user",
        content: "Foto",
        timestamp: 1,
        attachments: [
          {
            id: "stored-0-web_y.png",
            name: "web_y.png",
            kind: "image",
            url: "/api/chat/images/web_y.png",
          },
        ],
      },
    ];

    const merged = mergeMessageAttachments(base, rich);
    expect(merged[0].attachments?.[0].url).toBe("/api/chat/images/web_y.png");
  });
});

describe("coalesceAssistantTurns", () => {
  it("mantém bolhas separadas quando o turno anterior já concluiu", () => {
    const messages: ChatMessage[] = [
      {
        id: "a1",
        role: "assistant",
        content: "Protocolo concluído.",
        timestamp: 1_700_000_000_000,
        turnCompletedAt: 1_700_000_000_000,
      },
      {
        id: "a2",
        role: "assistant",
        content: "Bom dia, Fábio.",
        timestamp: 1_700_000_001_000,
      },
    ];
    const out = coalesceAssistantTurns(messages);
    expect(out).toHaveLength(2);
    expect(out[0]?.content).toBe("Protocolo concluído.");
    expect(out[1]?.content).toBe("Bom dia, Fábio.");
  });

  it("ainda funde linhas do mesmo turno (gap curto)", () => {
    const messages: ChatMessage[] = [
      {
        id: "a1",
        role: "assistant",
        content: "Vou verificar.",
        timestamp: 1_700_000_000_000,
      },
      {
        id: "a2",
        role: "assistant",
        content: "Pronto.",
        timestamp: 1_700_000_015_000,
      },
    ];
    const out = coalesceAssistantTurns(messages);
    expect(out).toHaveLength(1);
    expect(out[0]?.content).toContain("Vou verificar");
    expect(out[0]?.content).toContain("Pronto");
  });
});
