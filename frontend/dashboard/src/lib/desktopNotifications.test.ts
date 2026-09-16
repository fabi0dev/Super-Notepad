import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetDesktopNotificationsForTests,
  isDesktopApp,
  notifyApprovalRequested,
  notifyQuestionAsked,
  notifyTurnComplete,
  setTurnNotificationSummary,
  readNotifyOnApprovalFromConfig,
  readNotifyOnCompleteFromConfig,
} from "@/lib/desktopNotifications";
import {
  clearLiveMessageCacheForTests,
  writeCachedMessages,
} from "@/pages/ChatPage/chatMessageCache";

type Invoke = ReturnType<typeof vi.fn>;

function mountDesktopBridge(): Invoke {
  const invoke = vi.fn().mockResolvedValue(undefined);
  (window as unknown as Record<string, unknown>).__TAURI__ = { core: { invoke } };
  return invoke;
}

function setPageActive(active: boolean): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (active ? "visible" : "hidden"),
  });
  vi.spyOn(document, "hasFocus").mockReturnValue(active);
}

beforeEach(() => {
  clearLiveMessageCacheForTests();
  __resetDesktopNotificationsForTests();
  delete (window as unknown as Record<string, unknown>).__TAURI__;
  setPageActive(false);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as unknown as Record<string, unknown>).__TAURI__;
});

describe("detecção do app", () => {
  it("fica inerte no navegador", () => {
    expect(isDesktopApp()).toBe(false);
  });

  it("reconhece a ponte do Tauri", () => {
    mountDesktopBridge();
    expect(isDesktopApp()).toBe(true);
  });
});

describe("envio", () => {
  it("não decide foco pela página", () => {
    // `document.hasFocus()` não acompanha o foco da janela nativa numa
    // WKWebView; quem suprime por foco é o lado Rust. Aqui, envia.
    const invoke = mountDesktopBridge();
    setPageActive(true);

    notifyTurnComplete("sessao-1");

    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("envia com a janela fora de uso", () => {
    const invoke = mountDesktopBridge();

    notifyTurnComplete("sessao-1");

    expect(invoke).toHaveBeenCalledWith("notify", {
      request: expect.objectContaining({ tag: "sessao:sessao-1" }),
    });
  });

  it("nunca chama o IPC no navegador", () => {
    const invoke = vi.fn();
    notifyTurnComplete("sessao-1");
    notifyApprovalRequested();
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("deduplicação", () => {
  it("colapsa o mesmo turno anunciado por dois caminhos", () => {
    const invoke = mountDesktopBridge();

    // SSE e watcher global anunciam o mesmo fim de turno.
    notifyTurnComplete("sessao-1");
    notifyTurnComplete("sessao-1");

    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("mantém sessões diferentes independentes", () => {
    const invoke = mountDesktopBridge();

    notifyTurnComplete("sessao-1");
    notifyTurnComplete("sessao-2");

    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("suprime o 'concluído' genérico logo após um informativo (par de ids diferentes)", () => {
    const invoke = mountDesktopBridge();

    // Caminho com resumo (SSE DONE) e caminho genérico (watcher) usam ids
    // diferentes para o MESMO turno — o dedup por sid não os une.
    setTurnNotificationSummary("sessao-sse", "Memórias limpas: 4 removidas");
    notifyTurnComplete("sessao-sse");
    notifyTurnComplete("sessao-watcher"); // genérico, sid diferente → suprimido

    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("não suprime dois informativos de sessões diferentes", () => {
    const invoke = mountDesktopBridge();

    setTurnNotificationSummary("a", "resumo A");
    notifyTurnComplete("a");
    setTurnNotificationSummary("b", "resumo B");
    notifyTurnComplete("b");

    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("libera o mesmo evento depois da janela", () => {
    vi.useFakeTimers();
    const invoke = mountDesktopBridge();

    // A janela de dedup do fim de turno é longa (15s) DE PROPÓSITO: o SSE DONE
    // e o watcher global anunciam o mesmo turno com vários segundos de
    // diferença. Só depois dela o mesmo evento pode notificar de novo.
    notifyTurnComplete("sessao-1");
    vi.advanceTimersByTime(15_000);
    notifyTurnComplete("sessao-1");

    expect(invoke).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

describe("conteúdo", () => {
  // A REDAÇÃO é testada em notificationCopy.test.ts. Aqui interessa só o que
  // este módulo decide: qual campo recebe o quê, e a tag.
  it("põe o título da conversa no TÍTULO, não no corpo", () => {
    // É a linha em negrito e a única que sobrevive num banner estreito:
    // quem tem três conversas rodando precisa saber qual terminou.
    const invoke = mountDesktopBridge();

    notifyTurnComplete("sessao-1", "Migrar o billing");

    const { request } = invoke.mock.calls[0][1];
    expect(request.title).toBe("Migrar o billing");
    expect(request.body).toBeTruthy();
    expect(request.body).not.toBe("Migrar o billing");
  });

  it("sem título de conversa, o título ainda vem preenchido", () => {
    const invoke = mountDesktopBridge();

    notifyTurnComplete("sessao-1", "   ");

    const { request } = invoke.mock.calls[0][1];
    expect(request.title.trim()).not.toBe("");
    expect(request.body.trim()).not.toBe("");
  });

  it("ignora sessão vazia", () => {
    const invoke = mountDesktopBridge();
    notifyTurnComplete("   ");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("agrupa aprovação e pergunta sob a mesma tag", () => {
    const invoke = mountDesktopBridge();

    notifyApprovalRequested("Aprovar `rm -rf build`", "k1");
    notifyQuestionAsked("Prossigo com a migração?", "k2");

    expect(invoke).toHaveBeenNthCalledWith(1, "notify", {
      request: expect.objectContaining({
        tag: "atencao",
        // O detalhe é achatado (markdown → texto puro): as crases somem, senão
        // vazariam cruas para o banner do SO.
        body: "Aprovar rm -rf build",
      }),
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "notify", {
      request: expect.objectContaining({
        tag: "atencao",
        body: "Prossigo com a migração?",
      }),
    });
  });

  it("não deixa aprovação e pergunta se engolirem", () => {
    const invoke = mountDesktopBridge();

    // Antes as duas dividiam a chave de dedup: a segunda sumia.
    notifyApprovalRequested("aprova isto", "k1");
    notifyQuestionAsked("e isto?", "k2");

    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("ignora pergunta vazia", () => {
    const invoke = mountDesktopBridge();
    notifyQuestionAsked("   ");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("repete a mesma pergunta pendente uma vez só", () => {
    const invoke = mountDesktopBridge();

    notifyQuestionAsked("Prossigo?", "req-1");
    notifyQuestionAsked("Prossigo?", "req-1");

    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

describe("config", () => {
  it("liga por padrão quando a chave não existe", () => {
    expect(readNotifyOnCompleteFromConfig({})).toBe(true);
    expect(readNotifyOnApprovalFromConfig(null)).toBe(true);
  });

  it("respeita o desligamento explícito", () => {
    const config = { dashboard: { notifications: { on_complete: false, on_approval: false } } };
    expect(readNotifyOnCompleteFromConfig(config)).toBe(false);
    expect(readNotifyOnApprovalFromConfig(config)).toBe(false);
  });

  it("não confunde as duas chaves", () => {
    const config = { dashboard: { notifications: { on_complete: false } } };
    expect(readNotifyOnCompleteFromConfig(config)).toBe(false);
    expect(readNotifyOnApprovalFromConfig(config)).toBe(true);
  });
});

describe("contexto da resposta", () => {
  it("usa a última fala do agente como corpo", () => {
    // Era a queixa: depois de um commit e push, o aviso dizia só «Deixei a
    // resposta pronta» — servia para qualquer turno e não informava nenhum.
    const invoke = mountDesktopBridge();
    writeCachedMessages("sessao-ctx", [
      { id: "u1", role: "user", content: "faça commit e push" },
      {
        id: "a1",
        role: "assistant",
        content: "Feito ✅\n\n- **Commit:** `6ef9b427`\n- **Push:** enviado",
      },
    ] as never);

    notifyTurnComplete("sessao-ctx");

    const { request } = invoke.mock.calls[0][1];
    expect(request.body).toContain("Commit");
    expect(request.body).not.toContain("**");
  });

  it("anuncia o RESULTADO, não a intenção do meio do turno", () => {
    // O defeito real: a notificação dizia «Vou ver o status do repositório
    // antes de commitar» num turno que já tinha feito commit e push. A fala
    // intermediária estava no `content`; a resposta, no último segmento.
    const invoke = mountDesktopBridge();
    writeCachedMessages("sessao-fecho", [
      { id: "u1", role: "user", content: "faça commit e push" },
      {
        id: "a1",
        role: "assistant",
        content: "Vou ver o status do repositório antes de commitar.",
        segments: [
          { kind: "text", content: "Vou ver o status do repositório antes de commitar." },
          { kind: "text", content: "Commit e push feitos na branch feat/AXIS-573." },
        ],
      },
    ] as never);

    notifyTurnComplete("sessao-fecho");

    const { request } = invoke.mock.calls[0][1];
    expect(request.body).toBe("Commit e push feitos na branch feat/AXIS-573.");
    expect(request.body).not.toContain("Vou ver");
  });

  it("volta para a mensagem anterior quando a última não tem texto", () => {
    const invoke = mountDesktopBridge();
    writeCachedMessages("sessao-sem-texto", [
      {
        id: "a1",
        role: "assistant",
        content: "",
        segments: [{ kind: "text", content: "Commit e push enviados para a branch." }],
      },
      { id: "a2", role: "assistant", content: "", segments: [] },
    ] as never);

    notifyTurnComplete("sessao-sem-texto");

    expect(invoke.mock.calls[0][1].request.body).toBe(
      "Commit e push enviados para a branch.",
    );
  });

  it("fecho vago cai na frase canônica", () => {
    // «Tudo pronto.» é descartado pelo mesmo filtro de monólogo interno que a
    // timeline usa. Perder isso não custa nada: a frase canônica informa o
    // mesmo que um fecho que não diz o que foi feito.
    const invoke = mountDesktopBridge();
    writeCachedMessages("sessao-vaga", [
      { id: "a1", role: "assistant", content: "", segments: [{ kind: "text", content: "Tudo pronto." }] },
    ] as never);

    notifyTurnComplete("sessao-vaga");

    expect(invoke.mock.calls[0][1].request.body.trim()).not.toBe("");
  });

  it("prefere a fala mais recente do agente", () => {
    const invoke = mountDesktopBridge();
    writeCachedMessages("sessao-ctx2", [
      { id: "a1", role: "assistant", content: "Resposta antiga." },
      { id: "u1", role: "user", content: "e agora?" },
      { id: "a2", role: "assistant", content: "Resposta nova." },
    ] as never);

    notifyTurnComplete("sessao-ctx2");

    expect(invoke.mock.calls[0][1].request.body).toBe("Resposta nova.");
  });

  it("sem mensagens em cache, cai na frase canônica", () => {
    // Sessão que nunca foi aberta no painel — disparada pelo gateway ou pela
    // CLI. Não há o que resumir localmente.
    const invoke = mountDesktopBridge();

    notifyTurnComplete("sessao-sem-cache");

    expect(invoke.mock.calls[0][1].request.body.trim()).not.toBe("");
  });
});
