import { beforeEach, describe, expect, it } from "vitest";
import {
  __CONCLUSAO_CORPO_NEUTRO_FOR_TESTS as CORPO_NEUTRO,
  __VARIATIONS_FOR_TESTS as V,
  __resetVariationMemoryForTests,
  applyVocative,
  approvalCopy,
  pickVariation,
  questionCopy,
  readNicknameFromConfig,
  summarizeReply,
  turnCompleteCopy,
} from "@/lib/notificationCopy";

beforeEach(() => {
  __resetVariationMemoryForTests();
});

/** Toda forma que uma frase pode assumir, nas três colocações. */
function formasPossiveis(lista: readonly string[], apelido?: string): string[] {
  return lista.flatMap((t) => [
    applyVocative(t, apelido, "inicio"),
    applyVocative(t, apelido, "fim"),
    applyVocative(t, apelido, "nenhum"),
  ]);
}

describe("vocativo", () => {
  it("no início, a frase cai para minúscula", () => {
    expect(applyVocative("Acabei aqui", "Chefe", "inicio")).toBe("Chefe, acabei aqui");
    expect(applyVocative("Está pronto", "Chefe", "inicio")).toBe("Chefe, está pronto");
    expect(applyVocative("Posso seguir?", "Chefe", "inicio")).toBe("Chefe, posso seguir?");
  });

  it("não altera o apelido", () => {
    // Minúsculo em «Maria» seria erro; quem se ajusta é a frase.
    expect(applyVocative("Acabei aqui", "Maria", "inicio")).toBe("Maria, acabei aqui");
    expect(applyVocative("Acabei aqui", "Maria", "fim")).toBe("Acabei aqui, Maria");
  });

  it("a colocação «nenhum» deixa a frase intacta", () => {
    expect(applyVocative("Tudo certo por aqui", "Chefe", "nenhum")).toBe("Tudo certo por aqui");
  });

  it("entra antes da pontuação", () => {
    // «Posso seguir?, chefe» é a emenda que denuncia texto de máquina.
    expect(applyVocative("Posso seguir?", "chefe")).toBe("Posso seguir, chefe?");
    expect(applyVocative("Terminei!", "chefe")).toBe("Terminei, chefe!");
    expect(applyVocative("Está pronto.", "chefe")).toBe("Está pronto, chefe.");
  });

  it("apenas anexa quando não há pontuação final", () => {
    expect(applyVocative("Terminei", "chefe")).toBe("Terminei, chefe");
  });

  it("preserva reticências", () => {
    expect(applyVocative("Já vai…", "chefe")).toBe("Já vai, chefe…");
  });

  it("não mexe no texto sem apelido", () => {
    expect(applyVocative("Posso seguir?", undefined)).toBe("Posso seguir?");
    expect(applyVocative("Posso seguir?", "   ")).toBe("Posso seguir?");
  });
});

describe("apelido", () => {
  it("lê user.nickname", () => {
    expect(readNicknameFromConfig({ user: { nickname: "Chefe" } })).toBe("Chefe");
  });

  it("usa só o primeiro nome", () => {
    expect(readNicknameFromConfig({ user: { nickname: "Maria Silva" } })).toBe("Maria");
  });

  it("não inventa apelido quando não há", () => {
    // Diferente do menu de conta, aqui não cai para o e-mail nem para
    // «Conta»: ser chamado assim é pior que não ser chamado de nada.
    expect(readNicknameFromConfig({ user: { email: "fabio@exemplo.com" } })).toBeUndefined();
    expect(readNicknameFromConfig({ user: { nickname: "  " } })).toBeUndefined();
    expect(readNicknameFromConfig({})).toBeUndefined();
    expect(readNicknameFromConfig(null)).toBeUndefined();
  });
});

describe("variação", () => {
  it("não repete a mesma forma em seguida", () => {
    const lista = ["a", "b", "c"];
    let anterior = pickVariation("k", lista);
    for (let i = 0; i < 40; i += 1) {
      const atual = pickVariation("k", lista);
      expect(atual).not.toBe(anterior);
      anterior = atual;
    }
  });

  it("percorre mais de uma forma", () => {
    const vistos = new Set<string>();
    for (let i = 0; i < 60; i += 1) vistos.add(pickVariation("k", ["a", "b", "c", "d"]));
    expect(vistos.size).toBeGreaterThan(1);
  });

  it("aguenta lista de um item só", () => {
    expect(pickVariation("k", ["único"])).toBe("único");
    expect(pickVariation("k", ["único"])).toBe("único");
  });

  it("chaves diferentes não interferem entre si", () => {
    const a = pickVariation("x", ["a", "b"]);
    const b = pickVariation("y", ["a", "b"]);
    expect([a, b].every((v) => ["a", "b"].includes(v))).toBe(true);
  });
});

describe("conclusão", () => {
  it("usa o título da conversa como título da notificação", () => {
    const copy = turnCompleteCopy("Migrar o billing");
    expect(copy.title).toBe("Migrar o billing");
    // Sem resumo, corpo neutro — nada de persona.
    expect(copy.body).toBe(CORPO_NEUTRO);
  });

  it("sem conversa, o título é o rótulo neutro do app", () => {
    const copy = turnCompleteCopy(undefined);
    expect(copy.title).toBe("Super Note");
    expect(copy.body).toBe(CORPO_NEUTRO);
  });

  it("a conclusão nunca usa persona (vocativo ou frase variada)", () => {
    // O corpo é sempre concreto ou o fecho neutro; o título é a conversa ou o
    // rótulo do app. Rodar várias vezes garante que não há sorteio escondido.
    for (let i = 0; i < 30; i += 1) {
      const semConversa = turnCompleteCopy(undefined);
      expect(semConversa.title).toBe("Super Note");
      expect(semConversa.body).toBe(CORPO_NEUTRO);

      const comConversa = turnCompleteCopy("Migrar o billing");
      expect(comConversa.title).toBe("Migrar o billing");
      expect(comConversa.body).toBe(CORPO_NEUTRO);
    }
  });
});

describe("aprovação e pergunta", () => {
  it("aprovação usa o detalhe da ação como corpo", () => {
    const copy = approvalCopy("rm -rf build", "Chefe");
    expect(copy.body).toBe("rm -rf build");
    expect(formasPossiveis(V.APROVACAO_TITULO, "Chefe")).toContain(copy.title);
  });

  it("aprovação sem detalhe cai numa das formas de corpo", () => {
    const copy = approvalCopy(undefined, undefined);
    expect(V.APROVACAO_CORPO as readonly string[]).toContain(copy.body);
  });

  it("pergunta mantém o texto perguntado no corpo", () => {
    const copy = questionCopy("  Prossigo com a migração?  ", "Chefe");
    expect(copy.body).toBe("Prossigo com a migração?");
    expect(formasPossiveis(V.PERGUNTA_TITULO, "Chefe")).toContain(copy.title);
  });
});

describe("tom", () => {
  it("nenhuma forma usa vocabulário interno nem terceira pessoa", () => {
    const todas = Object.values(V).flatMap((lista) => [...lista]);
    for (const texto of todas) {
      expect(texto).not.toMatch(/turno/i);
      expect(texto).not.toMatch(/\bO Super Note\b/);
    }
  });
});

describe("resumo da resposta", () => {
  it("dá contexto em vez de frase canônica", () => {
    const resposta = [
      "Feito ✅",
      "",
      "- **Branch:** `feat/AXIS-573` (criada a partir de staging)",
      "- **Commit:** `6ef9b427`",
    ].join("\n");

    const resumo = summarizeReply(resposta);

    expect(resumo).toContain("Feito");
    expect(resumo).toContain("Branch");
    // Sem marcação crua no banner.
    expect(resumo).not.toContain("**");
    expect(resumo).not.toContain("`");
  });

  it("ignora blocos de código", () => {
    // Um `git push` como resumo é ruído: o comando já está na conversa.
    const resposta = [
      "```bash",
      "git push -u origin feat/AXIS-573",
      "```",
      "Push enviado e PR aberto.",
    ].join("\n");

    expect(summarizeReply(resposta)).toBe("Push enviado e PR aberto.");
  });

  it("junta linhas até haver informação de verdade", () => {
    // «Pronto» sozinho informa tanto quanto a frase canônica.
    const resumo = summarizeReply("Pronto\nCommit e push feitos na branch de feature.");
    expect(resumo).toBe("Pronto · Commit e push feitos na branch de feature.");
  });

  it("corta respostas longas com reticências", () => {
    const resumo = summarizeReply("x".repeat(400));
    expect(resumo!.length).toBeLessThanOrEqual(140);
    expect(resumo!.endsWith("…")).toBe(true);
  });

  it("devolve indefinido quando não sobra texto", () => {
    expect(summarizeReply("")).toBeUndefined();
    expect(summarizeReply("```\ncode\n```")).toBeUndefined();
  });
});

describe("conclusão com contexto", () => {
  it("o resumo concreto é o corpo", () => {
    const copy = turnCompleteCopy(undefined, "Commit e push feitos.");
    expect(copy.title).toBe("Super Note");
    expect(copy.body).toBe("Commit e push feitos.");
  });

  it("com título de conversa, título é a conversa e corpo é o resumo", () => {
    const copy = turnCompleteCopy("Migrar o billing", "Commit e push feitos.");
    expect(copy.title).toBe("Migrar o billing");
    expect(copy.body).toBe("Commit e push feitos.");
  });

  it("resumo em branco cai no fecho neutro", () => {
    const copy = turnCompleteCopy(undefined, "   ");
    expect(copy.body).toBe(CORPO_NEUTRO);
  });
});
