import { describe, expect, it } from "vitest";
import { parseLeadingJsonObject } from "./parseLeadingJson";

describe("parseLeadingJsonObject", () => {
  it("lê JSON puro", () => {
    expect(parseLeadingJsonObject('{"error":"falta text"}')).toEqual({
      error: "falta text",
    });
  });

  it("lê o objeto mesmo com nota do loop colada depois", () => {
    const raw =
      '{"error":"falta `text`","expected_params":{"required":["text"]}}\n\n' +
      "[Sistema: restam ~7 iterações de ferramenta neste turno.]";
    const parsed = parseLeadingJsonObject(raw);
    expect(parsed?.error).toBe("falta `text`");
  });

  it("recusa array e lixo", () => {
    expect(parseLeadingJsonObject("[1,2]")).toBeNull();
    expect(parseLeadingJsonObject("não é json")).toBeNull();
    expect(parseLeadingJsonObject("")).toBeNull();
  });
});
