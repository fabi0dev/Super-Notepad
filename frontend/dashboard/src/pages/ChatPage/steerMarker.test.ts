import { describe, it, expect } from "vitest";
import { extractSteerMessages, toolResultHasSteer } from "./steerMarker";

/**
 * Espelha EXATAMENTE `_steer_marker` (run_agent.py). Se o backend mudar a
 * redação, este helper diverge e os testes quebram — que é o objetivo: o
 * parser é ancorado no rodapé literal.
 */
function steerMarker(text: string): string {
  return (
    "\n\n---\n" +
    "[MESSAGE FROM THE USER — sent while you were working, not tool output]\n" +
    `${text}\n` +
    "---\n" +
    "Acknowledge this in one short line, then fold it into what you are " +
    "doing. If you were about to finish, handle this request before " +
    "ending the turn — do not leave it for later."
  );
}

describe("extractSteerMessages", () => {
  it("devolve o conteúdo intacto quando não há steer", () => {
    const out = extractSteerMessages("saída normal da ferramenta");
    expect(out.cleaned).toBe("saída normal da ferramenta");
    expect(out.steers).toEqual([]);
  });

  it("separa o steer do resultado real da ferramenta", () => {
    const content = "arquivo lido com sucesso" + steerMarker("Se vem do backend então deixa");
    const out = extractSteerMessages(content);
    expect(out.cleaned).toBe("arquivo lido com sucesso");
    expect(out.steers).toEqual(["Se vem do backend então deixa"]);
  });

  it("preserva steer de múltiplas linhas", () => {
    const texto = "primeira linha\nsegunda linha";
    const out = extractSteerMessages("ok" + steerMarker(texto));
    expect(out.cleaned).toBe("ok");
    expect(out.steers).toEqual([texto]);
  });

  it("extrai vários marcadores no mesmo resultado, em ordem", () => {
    const content = "base" + steerMarker("um") + steerMarker("dois");
    const out = extractSteerMessages(content);
    expect(out.cleaned).toBe("base");
    expect(out.steers).toEqual(["um", "dois"]);
  });

  it("ignora bloco de steer vazio", () => {
    const out = extractSteerMessages("saída" + steerMarker("   "));
    expect(out.cleaned).toBe("saída");
    expect(out.steers).toEqual([]);
  });

  it("toolResultHasSteer detecta o cabeçalho", () => {
    expect(toolResultHasSteer("nada aqui")).toBe(false);
    expect(toolResultHasSteer("x" + steerMarker("oi"))).toBe(true);
    expect(toolResultHasSteer(undefined)).toBe(false);
  });
});
