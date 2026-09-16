import { describe, expect, it } from "vitest";
import { singleFolderSegment } from "./notesShared";

describe("singleFolderSegment", () => {
  it("uma '/' no nome vira uma pasta só (solidus fullwidth), não aninhamento", () => {
    // Bug: "Estudos Backend/Devop" aparecia como duas pastas aninhadas.
    const out = singleFolderSegment("Estudos Backend/Devop");
    expect(out).toBe("Estudos Backend／Devop");
    // Não contém a "/" ASCII que o folderTree usa para dividir níveis.
    expect(out.includes("/")).toBe(false);
    expect(out.split("/")).toHaveLength(1);
  });

  it("nome sem barra passa intacto (só apara espaços)", () => {
    expect(singleFolderSegment("  Trabalho  ")).toBe("Trabalho");
  });

  it("apara barras nas pontas", () => {
    expect(singleFolderSegment("/Projetos/")).toBe("Projetos");
    expect(singleFolderSegment("a//b")).toBe("a／b");
  });

  it("barra invertida também não vira separador", () => {
    expect(singleFolderSegment("a\\b").includes("\\")).toBe(false);
    expect(singleFolderSegment("a\\b")).toBe("a／b");
  });

  it("vazio/whitespace vira string vazia (não cria pasta)", () => {
    expect(singleFolderSegment("   ")).toBe("");
    expect(singleFolderSegment("///")).toBe("");
  });
});
