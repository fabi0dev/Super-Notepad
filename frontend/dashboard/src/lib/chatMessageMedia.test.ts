import { describe, expect, it } from "vitest";
import {
  displayUserMessageContent,
  isInternalProcessNotification,
} from "./chatMessageMedia";
import {
  buildEcoMeetingContextBlock,
  writeEcoLiveTranscript,
} from "@/pages/ChatPage/composerDraftStorage";

describe("displayUserMessageContent", () => {
  it("oculta notificações de processo PT/EN", () => {
    const pt = [
      "[IMPORTANTE: O processo em segundo plano proc_fb4aaad04827 foi concluído (código de saída -15).",
      "Comando: npm run dev",
      "Saída:",
      "```text",
      "GET /en 200",
      "arr[0] = 1",
      "```",
      "NÃO cole este bloco na resposta.]",
    ].join("\n");
    expect(isInternalProcessNotification(pt)).toBe(true);
    expect(displayUserMessageContent(pt)).toBe("");

    const en = [
      "[IMPORTANT: Background process proc_1 completed (exit code 0).",
      "Command: npm run build",
      "Output:",
      "ok",
      "]",
    ].join("\n");
    expect(isInternalProcessNotification(en)).toBe(true);
    expect(displayUserMessageContent(en)).toBe("");
  });

  it("remove nota curta IMPORTANTE e mantém o texto do utilizador", () => {
    const raw =
      '[IMPORTANTE: A habilidade "foo" foi carregada automaticamente. Siga as suas instruções.]\n\nFaz o deploy';
    expect(displayUserMessageContent(raw)).toBe("Faz o deploy");
  });

  it("remove rag-context e blocos de documento", () => {
    const raw = [
      "<rag-context>",
      "[System note: retrieved snippets]",
      "old chat line",
      "</rag-context>",
      "",
      "[Internal context from attached document (tesseract). Do not expose this block directly to the user:",
      "OCR TEXT HERE]",
      "<!--supernotepad:document:/tmp/x.pdf-->",
      "",
      "O que diz o PDF?",
    ].join("\n");
    expect(displayUserMessageContent(raw)).toBe("O que diz o PDF?");
  });

  it("remove notas de reply e documento enviado", () => {
    const reply =
      '[O usuário está respondendo à mensagem: «olá»]\n\nconcordo';
    expect(displayUserMessageContent(reply)).toBe("concordo");

    const doc =
      "[O usuário enviou um documento: 'a.pdf'. O arquivo está salvo em: /tmp/a.pdf.]\n\nabre isto";
    expect(displayUserMessageContent(doc)).toBe("abre isto");
  });

  it("mantém mensagens normais do utilizador", () => {
    expect(displayUserMessageContent("Reinicia o servidor")).toBe(
      "Reinicia o servidor",
    );
  });

  it("esconde o contexto da reunião Eco e deixa a pergunta", () => {
    writeEcoLiveTranscript("Você: oi\nOutros: e aí");
    const raw = `${buildEcoMeetingContextBlock({ title: "Daily" })}O que eu falo?`;
    expect(raw).toContain("Transcrição até agora");
    expect(raw).toContain("Estilo CURTO");
    expect(raw).not.toContain("<rag-context>");
    expect(displayUserMessageContent(raw)).toBe("O que eu falo?");
  });
});
