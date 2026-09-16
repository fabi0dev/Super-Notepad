import { describe, expect, it } from "vitest";
import {
  collapseRepeatedHalf,
  mergeAssistantStreamChunk,
  normalizeSseToolName,
  parseSseDataPayload,
  parseSseEventKind,
  parseToolProgressPayload,
  resolveSseToolName,
  shouldInsertSpaceBetweenChunks,
} from "./chatSse";

describe("chatSse", () => {
  it("faz parse de payload SSE com multiplas linhas data", () => {
    const payload = parseSseDataPayload(
      "event: message\r\ndata: TOOL_START|{\"name\":\"shell\"}\r\ndata: continua\r\n\r\n",
    );
    expect(payload).toBe('TOOL_START|{"name":"shell"}\ncontinua');
  });

  it("retorna null quando nao ha linhas data", () => {
    expect(parseSseDataPayload("event: ping\nid: 1")).toBeNull();
  });

  it("separa kind e payload de evento SSE", () => {
    expect(parseSseEventKind("DONE")).toEqual({ kind: "DONE", payload: "" });
    expect(parseSseEventKind("TEXT|linha\\n2")).toEqual({
      kind: "TEXT",
      payload: "linha\n2",
    });
    expect(parseSseEventKind('TEXT|diz &quot;olá&quot;')).toEqual({
      kind: "TEXT",
      payload: 'diz "olá"',
    });
  });

  it("preserva `\\n` LITERAL no texto (não vira quebra de linha)", () => {
    // O servidor escapa a barra ANTES da quebra: um `\n` literal no texto
    // (bs+n) vai à rede como `\\n` (bs+bs+n). O cliente reverte o par e deve
    // devolver o `\n` literal — não uma quebra de verdade. `"a\\\\nb"` em TS é
    // a forma na rede (a, bs, bs, n, b) do original `a\nb` (a, bs, n, b).
    expect(parseSseEventKind("TEXT|a\\\\nb")).toEqual({
      kind: "TEXT",
      payload: "a\\nb",
    });
    // Quebra de linha real continua sendo desescapada normalmente.
    expect(parseSseEventKind("TEXT|linha\\n2")).toEqual({
      kind: "TEXT",
      payload: "linha\n2",
    });
  });

  it("não desfaz o escape de \\n em payloads JSON (kinds não-texto)", () => {
    // A pergunta do wiser tem uma quebra de parágrafo real, que o JSON.stringify
    // do backend já escapou como `\n` dentro da string — se o parser desfizer
    // esse escape (como fazia para os kinds de texto puro), o payload deixa de
    // ser JSON válido (newline cru dentro de uma string literal).
    const question = "Primeira frase.\n\nSegunda frase?";
    const jsonPayload = JSON.stringify({ question, choices: ["A", "B"] });
    const { kind, payload } = parseSseEventKind(`WISER_REQUEST|${jsonPayload}`);
    expect(kind).toBe("WISER_REQUEST");
    expect(payload).toBe(jsonPayload);
    expect(() => JSON.parse(payload)).not.toThrow();
    expect(JSON.parse(payload)).toEqual({ question, choices: ["A", "B"] });
  });

  it("normaliza nome de ferramenta invalido", () => {
    expect(normalizeSseToolName("")).toBe("tool");
    expect(normalizeSseToolName('{"name":"x"}')).toBe("tool");
    expect(normalizeSseToolName("a".repeat(97))).toBe("tool");
    expect(normalizeSseToolName("shell")).toBe("shell");
  });

  it("evita duplicacao de metades repetidas no stream (resposta longa)", () => {
    // Simula o bug real que a função existe para corrigir: a resposta final
    // inteira foi reenviada e colada duas vezes (reconexão/reenvio SSE).
    // Precisa ser longa o bastante para não colidir com o limiar
    // conservador (80 chars por metade) — ver teste abaixo para o caso curto.
    const half =
      "Aqui está o resumo completo que você pediu sobre o assunto discutido em detalhe.";
    expect(half.length).toBeGreaterThanOrEqual(80);
    expect(collapseRepeatedHalf(half + half)).toBe(half);
    expect(mergeAssistantStreamChunk("hello", "hello world")).toBe("hello world");
  });

  it("NAO colapsa duplicata curta que pode ser conteudo legitimo (regressao)", () => {
    // Antes do limiar conservador, qualquer par de metades curtas e
    // idênticas era apagado — mas uma resposta real pode legitimamente
    // repetir uma frase curta (ex. usuário pediu "diga X duas vezes").
    const shortRepeated = "abcabcabcabcabcabcabcabc"; // 24 chars, metade = 12
    expect(collapseRepeatedHalf(shortRepeated)).toBe(shortRepeated);

    const sentence = "Sim, sim.";
    expect(collapseRepeatedHalf(sentence + sentence)).toBe(sentence + sentence);
  });

  it("insere espaco entre letra e numero em deltas SSE", () => {
    expect(mergeAssistantStreamChunk("Só", "6.6GB livres")).toBe("Só 6.6GB livres");
    expect(mergeAssistantStreamChunk("usado de", "228GB")).toBe("usado de 228GB");
    expect(mergeAssistantStreamChunk("cheio**. Só", "6.6GB")).toBe("cheio**. Só 6.6GB");
  });

  it("nao parte cores hex CSS no stream", () => {
    expect(shouldInsertSpaceBetweenChunks("#3", "A8BAD")).toBe(false);
    expect(shouldInsertSpaceBetweenChunks("#2C6", "FA1")).toBe(false);
    expect(shouldInsertSpaceBetweenChunks("#36B", "9DB")).toBe(false);
    expect(mergeAssistantStreamChunk("#3", "A8BAD")).toBe("#3A8BAD");
    expect(mergeAssistantStreamChunk("#2C6", "FA1")).toBe("#2C6FA1");
    expect(mergeAssistantStreamChunk("`#3", "A 8 BAD`")).toBe("`#3A 8 BAD`");
  });

  it("nao parte hashes git / ranges no stream", () => {
    expect(shouldInsertSpaceBetweenChunks("43", "f9f8c")).toBe(false);
    expect(shouldInsertSpaceBetweenChunks("43f9f8c..e", "301e3b")).toBe(false);
    expect(shouldInsertSpaceBetweenChunks("e301", "e3b")).toBe(false);
    // Preposição curta + número com unidade continua inserindo espaço
    expect(shouldInsertSpaceBetweenChunks("usado de", "228GB")).toBe(true);

    let hash = "";
    for (const chunk of ["43", "f", "9", "f", "8", "c", "..", "e", "301", "e", "3", "b"]) {
      hash = mergeAssistantStreamChunk(hash, chunk);
    }
    expect(hash).toBe("43f9f8c..e301e3b");
  });

  it("nao insere espaco junto a delimitadores markdown", () => {
    expect(shouldInsertSpaceBetweenChunks("**", "azul-ciano**")).toBe(false);
    expect(shouldInsertSpaceBetweenChunks("é **", "azul-ciano**")).toBe(false);
    expect(shouldInsertSpaceBetweenChunks("(`", "#2C6FA1`)")).toBe(false);
    expect(mergeAssistantStreamChunk("é **", "azul-ciano**")).toBe(
      "é **azul-ciano**",
    );
  });

  it("nao insere espaco no meio de palavras partidas", () => {
    expect(mergeAssistantStreamChunk("hel", "lo")).toBe("hello");
    expect(shouldInsertSpaceBetweenChunks("hel", "lo")).toBe(false);
  });

  it("preserva espaco existente no chunk", () => {
    expect(mergeAssistantStreamChunk("usado de", " 228GB")).toBe("usado de 228GB");
  });

  it("nao engole letra dobrada partida em deltas de 1 char (regressao: voo virava vo)", () => {
    // Bug real: "voo" chegando como deltas "v", "o", "o" — o segundo "o"
    // coincide com o fim do que já foi mostrado ("...vo" também termina em
    // "o"), e o antigo `curN.endsWith(nextN)` sem limiar mínimo descartava
    // o caractere inteiro em vez de reconhecer que era conteúdo novo.
    let acc = "";
    for (const chunk of ["Foi um", " bom", " v", "o", "o", ":"]) {
      acc = mergeAssistantStreamChunk(acc, chunk);
    }
    expect(acc).toBe("Foi um bom voo:");
  });

  it("ainda ignora reenvio de sufixo longo ja mostrado (reconexao SSE)", () => {
    // Contraste com o teste acima: um reenvio de verdade repete um trecho
    // longo o bastante para não ser coincidência — esse ainda deve ser
    // tratado como duplicata e descartado.
    const current =
      "Aqui está o resumo completo que você pediu sobre o assunto.";
    const resentTail = current.slice(-20);
    expect(resentTail.length).toBeGreaterThanOrEqual(8);
    expect(mergeAssistantStreamChunk(current, resentTail)).toBe(current);
  });

  it("infere nome da ferramenta a partir da linha tecnica", () => {
    expect(resolveSseToolName("", "terminal: git status")).toBe("terminal");
    expect(resolveSseToolName("tool", "shell: ls -la")).toBe("shell");
    expect(resolveSseToolName("", "")).toBe("tool");
  });

  it("parseia TOOL_PROGRESS em JSON", () => {
    expect(
      parseToolProgressPayload(
        JSON.stringify({
          event: "tool.started",
          name: "terminal",
          preview: "Verificando sn-agent",
          technical: "terminal: git status --short",
        }),
      ),
    ).toEqual({
      eventType: "tool.started",
      toolName: "terminal",
      preview: "Verificando sn-agent",
      technical: "terminal: git status --short",
    });
  });
});
