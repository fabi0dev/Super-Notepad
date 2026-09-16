import { describe, expect, it } from "vitest";
import {
  extractScriptPathHint,
  humanizeScriptStdout,
} from "./humanizeScriptStdout";

describe("humanizeScriptStdout", () => {
  it("humaniza existe/tamanho com caminho do script", () => {
    const args = JSON.stringify({
      code: 'path = "/Users/dev/.cache/thumb.png"\nprint(f"Existe: {True}")',
    });
    const pathHint = extractScriptPathHint(args);
    const body = humanizeScriptStdout(
      "Existe: True\nTamanho: 213.4 KB\nStatus: success\n",
      { pathHint },
    );
    expect(body).toContain("~/.cache/thumb.png: encontrado");
    expect(body).toContain("Tamanho · ~/.cache/thumb.png: 213.4 KB");
    expect(body).toContain("Status: concluído");
    expect(body).not.toContain("Existe: True");
  });

  it("humaniza chaves genéricas e booleanos", () => {
    const body = humanizeScriptStdout(
      "found: false\nfile_count: 3\nworking_directory: /tmp\nerror: none\n",
    );
    expect(body).toContain("Encontrado: não");
    expect(body).toContain("File Count: 3");
    expect(body).toContain("Diretório de trabalho: /tmp");
    expect(body).toContain("Erro: —");
  });

  it("humaniza exit_code e omite metadados internos", () => {
    const body = humanizeScriptStdout(
      "exit_code: 0\ntool_calls_made: 0\nduration_seconds: 0.21\n",
    );
    expect(body).toContain("Comando concluído (código 0)");
    expect(body).toContain("Duração: 0.21s");
    expect(body).not.toContain("tool_calls_made");
  });

  it("preserva linhas sem formato chave:valor", () => {
    const body = humanizeScriptStdout("Processando lote 2 de 5…\n");
    expect(body).toBe("Processando lote 2 de 5…");
  });

  it("humaniza chave=valor sem espaço após igual", () => {
    const body = humanizeScriptStdout("rows=12\nmatches=3\nelapsed=0.45\n");
    expect(body).toContain("Linhas: 12");
    expect(body).toContain("Correspondências: 3");
    expect(body).toContain("Duração: 0.45s");
  });

  it("expande JSON inline em uma linha", () => {
    const body = humanizeScriptStdout('{"status":"success","count":2}');
    expect(body).toContain("Status: concluído");
    expect(body).toContain("Total: 2");
  });

  it("formata objetos aninhados sem [object Object]", () => {
    const body = humanizeScriptStdout('{"bitcoin":{"brl":573420,"usd":98450}}');
    expect(body).toContain("Bitcoin:");
    expect(body).toContain("Brl:");
    expect(body).toContain("Usd:");
    expect(body).not.toContain("[object Object]");
  });

  it("formata linha chave:valor com JSON aninhado", () => {
    const body = humanizeScriptStdout('Bitcoin: {"brl":573420,"usd":98450}');
    expect(body).toContain("Bitcoin:");
    expect(body).not.toContain("[object Object]");
  });

  it("extrai path de Path.home() no script", () => {
    const args = JSON.stringify({
      code: 'p = Path.home() / ".cache/thumb.png"\nprint(p)',
    });
    expect(extractScriptPathHint(args)).toContain("~/.cache/thumb.png");
  });
});
