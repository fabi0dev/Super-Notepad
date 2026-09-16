import { describe, expect, it } from "vitest";
import { buildMarkdownUnifiedDiff } from "./planMarkdownDiff";

describe("buildMarkdownUnifiedDiff", () => {
  it("retorna vazio quando textos são iguais", () => {
    const text = "## Plano\n\n### Passos\n1. Um\n2. Dois";
    expect(buildMarkdownUnifiedDiff(text, text, "plan.md")).toBe("");
  });

  it("gera unified diff para alterações de linha", () => {
    const oldText = "## Plano\n\n### Objetivo\nLiberar espaço.\n\n### Passos\n1. Medir DerivedData";
    const newText = "## Plano\n\n### Objetivo\nLiberar espaço com segurança.\n\n### Passos\n1. Medir DerivedData";
    const diff = buildMarkdownUnifiedDiff(oldText, newText, "~/.super-notepad/plans/sess.md");
    expect(diff).toContain("--- a/sess.md");
    expect(diff).toContain("+++ b/sess.md");
    expect(diff).toContain("-Liberar espaço.");
    expect(diff).toContain("+Liberar espaço com segurança.");
  });
});
