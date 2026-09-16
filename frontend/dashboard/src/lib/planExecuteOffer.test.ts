import { describe, expect, it, beforeEach } from "vitest";
import {
  buildPlanMessageSnapshot,
  clearStoredExecutedPlanFingerprint,
  clearStoredPlanDismissed,
  clearStoredPlanExecuteOffer,
  dismissStoredPlanExecuteOffer,
  extractPlanSection,
  findPreviousPlanMarkdown,
  hasPersistedPlanContent,
  isActionablePlan,
  isPlanExecuteDismissedForMessage,
  normalizePlanDisplayMarkdown,
  planMarkdownFromAssistantMessage,
  planMarkdownFromMessage,
  planMarkdownFromTodoSnapshot,
  readStoredPlanDismissed,
  readStoredPlanExecuteOffer,
  stripPlanFrontmatter,
  planSectionIsDisplayable,
  findLatestPlanMessageId,
  resolveAssistantPlanForDisplay,
  resolveExecutablePlanMessageId,
  shouldStripPlanFromAssistantText,
  stripPlanSectionForDisplay,
  stripPlanTitleHeading,
  writeStoredPlanExecuteOffer,
} from "./planExecuteOffer";

const VALID_PLAN = `Conversa antes do plano.

## Plano

### Objetivo
Implementar feature X.

### Passos
1. Ler foo.py e mapear dependências do módulo.
2. Adicionar helper em bar.ts com tipos explícitos.
3. Integrar na UI e validar build do dashboard.
`;

describe("planExecuteOffer storage", () => {
  const sid = "session-plan-offer";

  beforeEach(() => {
    dismissStoredPlanExecuteOffer(sid);
    clearStoredPlanDismissed(sid);
  });

  it("persiste e restaura oferta por sessão", () => {
    writeStoredPlanExecuteOffer({
      sessionId: sid,
      messageId: "assistant-1",
    });
    expect(readStoredPlanExecuteOffer(sid)).toEqual({
      sessionId: sid,
      messageId: "assistant-1",
    });
  });

  it("limpa oferta da sessão", () => {
    writeStoredPlanExecuteOffer({
      sessionId: sid,
      messageId: "assistant-1",
    });
    clearStoredPlanExecuteOffer(sid);
    expect(readStoredPlanExecuteOffer(sid)).toBeNull();
  });

  it("dispensar persiste flag por mensagem e remove oferta", () => {
    writeStoredPlanExecuteOffer({
      sessionId: sid,
      messageId: "assistant-1",
    });
    dismissStoredPlanExecuteOffer(sid, "assistant-1");
    expect(readStoredPlanExecuteOffer(sid)).toBeNull();
    expect(readStoredPlanDismissed(sid)).toBe(true);
    expect(isPlanExecuteDismissedForMessage(sid, "assistant-1")).toBe(true);
    expect(isPlanExecuteDismissedForMessage(sid, "assistant-2")).toBe(false);
  });

  it("nova oferta limpa flag de dispensado", () => {
    dismissStoredPlanExecuteOffer(sid, "assistant-1");
    writeStoredPlanExecuteOffer({
      sessionId: sid,
      messageId: "assistant-2",
    });
    expect(readStoredPlanDismissed(sid)).toBe(false);
    expect(isPlanExecuteDismissedForMessage(sid, "assistant-1")).toBe(false);
  });
});

describe("resolveExecutablePlanMessageId", () => {
  const sid = "session-executable-plan";
  const planMessage = {
    id: "asst-plan",
    role: "assistant",
    planSnapshot: { markdown: VALID_PLAN },
  };
  const otherMessage = {
    id: "asst-other",
    role: "assistant",
    content: "Só uma resposta curta.",
  };

  beforeEach(() => {
    clearStoredPlanDismissed(sid);
    clearStoredPlanExecuteOffer(sid);
    clearStoredExecutedPlanFingerprint(sid);
  });

  it("não mostra Executar em modo agente (plano só informativo)", () => {
    expect(
      resolveExecutablePlanMessageId({
        messages: [planMessage],
        sessionId: sid,
        planMode: false,
        offerMessageId: "asst-plan",
      }),
    ).toBeNull();
  });

  it("esconde Executar quando as tarefas já começaram", () => {
    expect(
      resolveExecutablePlanMessageId({
        messages: [
          {
            ...planMessage,
            todoSnapshot: {
              todos: [
                { content: "Passo 1", status: "in_progress" },
                { content: "Passo 2", status: "pending" },
              ],
              summary: {
                in_progress: 1,
                completed: 0,
              },
            },
          },
        ],
        sessionId: sid,
        planMode: true,
        offerMessageId: "asst-plan",
      }),
    ).toBeNull();
  });

  it("prefere o plano mais recente com conteúdo à oferta vazia", () => {
    expect(
      resolveExecutablePlanMessageId({
        messages: [planMessage, otherMessage],
        sessionId: sid,
        planMode: true,
        offerMessageId: "asst-other",
      }),
    ).toBe("asst-plan");
  });

  it("usa a oferta enquanto o plano ainda está a carregar", () => {
    expect(
      resolveExecutablePlanMessageId({
        messages: [otherMessage],
        sessionId: sid,
        planMode: true,
        offerMessageId: "asst-other",
        loadingMessageId: "asst-other",
      }),
    ).toBe("asst-other");
  });

  it("cai no plano mais recente se a oferta apontar para id inexistente", () => {
    expect(
      resolveExecutablePlanMessageId({
        messages: [planMessage, otherMessage],
        sessionId: sid,
        planMode: true,
        offerMessageId: "missing-id",
      }),
    ).toBe("asst-plan");
  });

  it("esconde Executar após o plano ter sido executado (fingerprint)", () => {
    dismissStoredPlanExecuteOffer(sid, "asst-plan", VALID_PLAN);
    expect(
      resolveExecutablePlanMessageId({
        messages: [planMessage],
        sessionId: sid,
        offerMessageId: "asst-plan",
      }),
    ).toBeNull();
  });

  it("esconde após dismiss do plano atual", () => {
    dismissStoredPlanExecuteOffer(sid, "asst-plan");
    expect(
      resolveExecutablePlanMessageId({
        messages: [planMessage],
        sessionId: sid,
        planMode: true,
        offerMessageId: "asst-plan",
      }),
    ).toBeNull();
  });
});

describe("stripPlanFrontmatter", () => {
  it("remove bloco YAML no início", () => {
    const raw = `---
session_id: abc
created_at: 2026-07-06T16:16:30Z
---

## Plano

Passo 1`;
    expect(stripPlanFrontmatter(raw)).toBe("## Plano\n\nPasso 1");
  });

  it("retorna markdown sem frontmatter inalterado", () => {
    const raw = "## Plano\n\nConteúdo";
    expect(stripPlanFrontmatter(raw)).toBe(raw);
  });

  it("retorna string vazia para entrada vazia", () => {
    expect(stripPlanFrontmatter("")).toBe("");
    expect(stripPlanFrontmatter("   ")).toBe("");
  });
});

describe("extractPlanSection", () => {
  it("extrai seção ## Plano sem preâmbulo", () => {
    const section = extractPlanSection(VALID_PLAN);
    expect(section.startsWith("## Plano")).toBe(true);
    expect(section).not.toContain("Conversa antes");
  });

  it("rejeita texto sem seção estruturada", () => {
    expect(
      extractPlanSection("Modo Plano — terminal bloqueada. Use o dropdown."),
    ).toBe("");
  });
});

describe("isActionablePlan", () => {
  it("aceita plano com passos numerados", () => {
    const section = extractPlanSection(VALID_PLAN);
    expect(isActionablePlan(section)).toBe(true);
  });

  it("rejeita chatter de bloqueio", () => {
    expect(
      isActionablePlan(
        "Modo Plano ativo. Terminal bloqueada. Use Executar plano no dropdown.",
      ),
    ).toBe(false);
  });
});

describe("stripPlanTitleHeading", () => {
  it("remove heading Plano duplicado", () => {
    expect(stripPlanTitleHeading("## Plano\n\n### Objetivo\n\nFoo")).toBe(
      "### Objetivo\n\nFoo",
    );
  });
});

describe("normalizePlanDisplayMarkdown", () => {
  it("remove frontmatter e título duplicado", () => {
    const raw = `---
session_id: x
---

## Plano

### Passos
1. Um
2. Dois`;
    expect(normalizePlanDisplayMarkdown(raw)).toBe(
      "### Passos\n1. Um\n2. Dois",
    );
  });
});

describe("hasPersistedPlanContent", () => {
  it("aceita plano salvo com frontmatter", () => {
    const raw = `---
session_id: abc
created_at: 2026-07-06T16:16:30Z
---

## Plano

### Passos
1. Auditar componentes React do dashboard.
2. Aplicar tokens neutros no card e modal de plano.
3. Validar build e testes Vitest.`;
    expect(hasPersistedPlanContent(raw)).toBe(true);
  });

  it("rejeita arquivo vazio ou ruído", () => {
    expect(hasPersistedPlanContent("")).toBe(false);
    expect(
      hasPersistedPlanContent("Modo Plano — terminal bloqueada."),
    ).toBe(false);
  });
});

describe("planMarkdownFromAssistantMessage", () => {
  it("extrai só a seção de plano da mensagem", () => {
    const text = planMarkdownFromAssistantMessage(
      [
        {
          id: "a1",
          role: "assistant",
          content: VALID_PLAN,
        },
      ],
      "a1",
    );
    expect(text).toContain("Implementar feature X");
    expect(text).not.toContain("Conversa antes");
  });

  it("retorna vazio para mensagem sem plano estruturado", () => {
    const text = planMarkdownFromAssistantMessage(
      [
        {
          id: "a1",
          role: "assistant",
          content: "Modo Plano — terminal bloqueada. Use o dropdown.",
        },
      ],
      "a1",
    );
    expect(text).toBe("");
  });

  it("planMarkdownFromMessage usa todo quando texto não tem ## Plano", () => {
    const text = planMarkdownFromMessage(
      [
        {
          id: "a1",
          role: "assistant",
          content: "Organizei as etapas abaixo.",
          todoSnapshot: {
            todos: [
              { content: "Auditar componentes React do dashboard", status: "pending" },
              { content: "Aplicar tokens neutros no card de plano", status: "pending" },
            ],
          },
        },
      ],
      "a1",
    );
    expect(text).toContain("Auditar componentes");
  });

  it("remove seção ## Plano do texto exibido no chat", () => {
    expect(
      stripPlanSectionForDisplay(
        "Entendi o pedido.\n\n## Plano\n\n### Passos\n1. Fazer X",
      ),
    ).toBe("Entendi o pedido.");
  });

  it("resolveAssistantPlanForDisplay extrai plano do texto sem snapshot", () => {
    const plan = resolveAssistantPlanForDisplay({
      role: "assistant",
      content: `Ok.\n\n## Plano\n\n### Objetivo\nLiberar espaço.\n\n### Passos\n1. Medir DerivedData com du -sh.\n2. Limpar caches seguros com rm -rf.`,
    });
    expect(plan?.markdown).toContain("Liberar espaço");
    expect(plan?.markdown).not.toContain("Ok.");
  });

  it("shouldStripPlanFromAssistantText com ## Plano", () => {
    expect(
      shouldStripPlanFromAssistantText({
        role: "assistant",
        content:
          "Contexto.\n\n## Plano\n\n### Passos\n1. Primeiro passo detalhado.\n2. Segundo passo detalhado.",
      }),
    ).toBe(true);
  });

  it("buildPlanMessageSnapshot inclui diff contra revisão anterior", () => {
    const previous = "## Plano\n\n### Passos\n1. Medir DerivedData\n2. Limpar cache";
    const next = "## Plano\n\n### Passos\n1. Medir DerivedData\n2. Limpar cache com segurança";
    const snapshot = buildPlanMessageSnapshot(next, "plan.md", previous, 2);
    expect(snapshot.diff).toContain("-2. Limpar cache");
    expect(snapshot.diff).toContain("+2. Limpar cache com segurança");
  });

  it("findPreviousPlanMarkdown retorna último plano antes da mensagem", () => {
    const markdown = findPreviousPlanMarkdown(
      [
        { id: "a1", planSnapshot: { markdown: "## Plano\n\n1. Primeiro" } },
        { id: "a2" },
      ],
      "a2",
    );
    expect(markdown).toContain("Primeiro");
  });

  it("deriva plano do todoSnapshot para o card", () => {
    const todoSnapshot = {
      todos: [
        {
          content:
            "Extrair HeroEnergyLines para src/components/hero-energy-lines.tsx com tipos explícitos",
          status: "pending",
        },
        {
          content:
            "Refatorar page.tsx para usar os novos componentes e validar build sem regressões",
          status: "in_progress",
        },
      ],
    };
    expect(
      resolveAssistantPlanForDisplay({ role: "assistant", todoSnapshot })
        ?.markdown,
    ).toContain("HeroEnergyLines");
  });
});

describe("planSectionIsDisplayable — limiar de exibição baixo e estável", () => {
  it("cabeçalho + corpo curto já conta (antes exigia 40 chars)", () => {
    // "## Plano\nObjetivo: X" tem menos de 40 chars e agora é detectado —
    // fim do flicker "em cima e depois embaixo".
    expect(planSectionIsDisplayable("## Plano\nObjetivo: X")).toBe(true);
  });

  it("cabeçalho sozinho, sem corpo, ainda não conta", () => {
    // Carregar o card no primeiro instante do heading, sem conteúdo, seria
    // cedo demais — não há o que mostrar.
    expect(planSectionIsDisplayable("## Plano")).toBe(false);
    expect(planSectionIsDisplayable("## Plano\n")).toBe(false);
    expect(planSectionIsDisplayable("## Plano\n   ")).toBe(false);
  });

  it("plano acionável continua contando", () => {
    expect(
      planSectionIsDisplayable(
        "## Plano\n\n### Passos\n1. Primeiro passo\n2. Segundo passo",
      ),
    ).toBe(true);
  });

  it("texto vazio não conta", () => {
    expect(planSectionIsDisplayable("")).toBe(false);
  });
});

describe("detecção do plano estável durante o streaming", () => {
  // O botão Executar sumia porque, antes do freeze, ele depende só desta
  // detecção. O antigo limiar de 40 chars caía quando um frame de streaming
  // encolhia o texto combinado; o cabeçalho + corpo curto sobrevive.
  it("detecta o plano assim que o corpo começa, mesmo curto", () => {
    const plan = resolveAssistantPlanForDisplay({
      role: "assistant",
      content: "Vou explorar.\n\n## Plano\nObjetivo: esvaziar a lixeira",
    });
    expect(plan?.markdown).toContain("Objetivo");
  });

  it("findLatestPlanMessageId acha a mensagem com plano curto", () => {
    const id = findLatestPlanMessageId([
      { id: "u1", role: "user", content: "limpa a lixeira" },
      {
        id: "a1",
        role: "assistant",
        content: "Ok.\n\n## Plano\nObjetivo: limpar",
      },
    ]);
    expect(id).toBe("a1");
  });

  it("strip e card usam o MESMO limiar (sem duplicação)", () => {
    // Se divergissem, o plano apareceria na conversa E no card ao mesmo tempo.
    const texto = "Contexto.\n\n## Plano\nObjetivo: X";
    const msg = { role: "assistant", content: texto };
    const mostra = resolveAssistantPlanForDisplay(msg) != null;
    const remove = shouldStripPlanFromAssistantText(msg);
    expect(mostra).toBe(remove);
  });
});
