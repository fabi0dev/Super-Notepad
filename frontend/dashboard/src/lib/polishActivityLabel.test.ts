import { describe, expect, it } from "vitest";
import {
  formatToolArgHint,
  looksLikeLiteralHint,
  polishActivityLabel,
} from "./polishActivityLabel";

describe("polishActivityLabel", () => {
  it("converte 'Vou …' repetitivo em gerúndio", () => {
    expect(polishActivityLabel("vou enviar alterações")).toBe(
      "Enviando alterações",
    );
    expect(polishActivityLabel("Vou verificar o estado do repositório")).toBe(
      "Verificando o estado do repositório",
    );
  });

  it("converte 'Vamos …' da mesma forma", () => {
    expect(polishActivityLabel("vamos executar os testes")).toBe(
      "Executando os testes",
    );
  });

  it("mantém frases já em gerúndio ou objetivas", () => {
    expect(polishActivityLabel("verificando o horario atual")).toBe(
      "Verificando o horario atual",
    );
    expect(polishActivityLabel("Conferindo diff das alterações")).toBe(
      "Conferindo diff das alterações",
    );
    expect(polishActivityLabel("Commit com trailer")).toBe("Commit com trailer");
  });

  it("simplifica 'Estou + gerúndio'", () => {
    expect(polishActivityLabel("estou analisando o diff")).toBe(
      "Analisando o diff",
    );
  });

  it("transforma infinitivo solto em gerúndio", () => {
    expect(polishActivityLabel("criar commit no repositório")).toBe(
      "Criando commit no repositório",
    );
  });

  it("não reescreve caminhos, URLs nem comandos", () => {
    expect(polishActivityLabel("/home/user/projeto")).toBe("/home/user/projeto");
    expect(polishActivityLabel("git status --porcelain")).toBe(
      "git status --porcelain",
    );
    expect(polishActivityLabel("https://example.com/docs")).toBe(
      "https://example.com/docs",
    );
  });

  it("traduz wait proc do preview legado", () => {
    expect(polishActivityLabel("wait proc_45aeb379d3a 600s")).toBe(
      "Aguardando o processo",
    );
  });
});

describe("looksLikeLiteralHint", () => {
  it("detecta literais técnicos", () => {
    expect(looksLikeLiteralHint("./src/App.tsx")).toBe(true);
    expect(looksLikeLiteralHint("npm test")).toBe(true);
    expect(looksLikeLiteralHint("buscar autenticação nestjs")).toBe(false);
  });
});

describe("formatToolArgHint", () => {
  it("preserva literais e trunca quando necessário", () => {
    const longPath = `/tmp/${"x".repeat(200)}`;
    expect(formatToolArgHint(longPath)).toHaveLength(140);
    expect(formatToolArgHint(longPath).endsWith("…")).toBe(true);
    expect(formatToolArgHint("src/lib/utils.ts")).toBe("src/lib/utils.ts");
  });
});
