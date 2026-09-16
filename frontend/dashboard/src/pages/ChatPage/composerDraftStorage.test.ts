import { afterEach, describe, expect, it } from "vitest";
import {
  clearComposerDraft,
  getComposerDraftStorageKey,
  readComposerDraft,
  readEcoLiveMeta,
  writeComposerDraft,
  writeEcoLiveMeta,
  writeEcoLiveTranscript,
  buildEcoMeetingContextBlock,
} from "./composerDraftStorage";

describe("composerDraftStorage", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("usa chave separada para landing e sessão", () => {
    expect(getComposerDraftStorageKey(null)).toBe("supernotepad:chat:draft:__new__");
    expect(getComposerDraftStorageKey("sess-1")).toBe(
      "supernotepad:chat:draft:sess-1",
    );
  });

  it("persiste e restaura rascunho da landing", () => {
    writeComposerDraft(null, "olá landing");
    expect(readComposerDraft(null)).toBe("olá landing");
  });

  it("persiste e restaura rascunho por sessão", () => {
    writeComposerDraft("abc", "mensagem da sessão");
    expect(readComposerDraft("abc")).toBe("mensagem da sessão");
    expect(readComposerDraft("xyz")).toBe("");
  });

  it("remove rascunho vazio do storage", () => {
    writeComposerDraft("abc", "temp");
    clearComposerDraft("abc");
    expect(window.localStorage.getItem("supernotepad:chat:draft:abc")).toBeNull();
    expect(readComposerDraft("abc")).toBe("");
  });

  it("persiste meta ao vivo do Eco", () => {
    writeEcoLiveMeta({ title: "Daily Axis", tags: ["trabalho"] });
    expect(readEcoLiveMeta()).toEqual({
      title: "Daily Axis",
      tags: ["trabalho"],
    });
    writeEcoLiveMeta(null);
    expect(readEcoLiveMeta()).toBeNull();
  });

  it("sem transcrição pede para dizer que ainda está ouvindo", () => {
    writeEcoLiveTranscript("");
    const block = buildEcoMeetingContextBlock({ title: "Daily" });
    expect(block).toContain("ainda está ouvindo");
    expect(block).toContain("NÃO peça o trecho");
    expect(block).not.toContain("só pano de fundo");
  });

  it("com transcrição trata o áudio como o trecho", () => {
    writeEcoLiveTranscript("Outros: primeiro episódio de Dark");
    const block = buildEcoMeetingContextBlock({ title: "Daily" });
    expect(block).toContain("primeiro episódio de Dark");
    expect(block).toContain("É o trecho");
    expect(block).toContain("NÃO pergunte 'qual parte'");
  });
});
