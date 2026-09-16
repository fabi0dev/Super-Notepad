import { describe, expect, it } from "vitest";
import { decodeHtmlEntities } from "./decodeHtmlEntities";

describe("decodeHtmlEntities", () => {
  it("decodifica entidades nomeadas comuns", () => {
    expect(decodeHtmlEntities("foo &amp; bar &quot;baz&quot;")).toBe(
      'foo & bar "baz"',
    );
  });

  it("decodifica entidades numéricas decimais com acentos", () => {
    expect(decodeHtmlEntities("resqu&#237;cio")).toBe("resquício");
  });

  it("decodifica entidades numéricas", () => {
    expect(decodeHtmlEntities("&#34;ok&#39;")).toBe('"ok\'');
  });

  it("não altera texto sem entidades", () => {
    expect(decodeHtmlEntities("git status && ls")).toBe("git status && ls");
  });

  it("preserva email entre <> em git --author", () => {
    expect(
      decodeHtmlEntities(
        'git commit --author="Fábio <fabio@email.com>" -m "feat"',
      ),
    ).toBe('git commit --author="Fábio <fabio@email.com>" -m "feat"');
  });
});
