import { describe, expect, it } from "vitest";
import { setNestedValue } from "./nested";
import {
  APPEARANCE_CATEGORY,
  AUDIO_CATEGORY,
  collectConfigNavCategories,
  CONFIG_NAV_GROUPS,
  getConfigFieldDescription,
  getConfigFieldLabel,
  getConfigOptionLabel,
  normalizeConfigSchema,
  PERSONA_DESCRIPTION_BY_VALUE,
  PROFILE_CATEGORY,
  resolveActiveConfigCategory,
  shouldFillConfigCategoryUrl,
  shouldShowConfigField,
  withPersonaCompanion,
} from "./configPresentation";

// Regression: user.* persona fields (nickname, personality, etc.) were once
// invisible in the dashboard even though HIDDEN_CONFIG_PREFIXES/category
// remapping were correct — a separate allowlist (COMMON_USER_CONFIG_FIELDS)
// filtered them out before that logic ever ran. Cover both layers so this
// can't regress silently again.

const PERSONA_FIELDS = [
  "user.nickname",
  "user.personality",
  "user.behavior",
  "user.custom_instructions",
  "user.timezone",
] as const;

const HIDDEN_PERSONA_DETAIL_FIELDS = [
  "user.personality_description",
  "user.behavior_description",
] as const;

describe("shouldShowConfigField — allowlist de comandos", () => {
  it("mostra a lista de comandos sempre permitidos", () => {
    // `shouldShowConfigField` é lista de PERMISSÃO: ter rótulo, descrição e
    // tipo no schema não basta — sem estar no conjunto, o campo nunca é
    // pintado. Foi assim que a allowlist ficou invisível depois de pronta.
    expect(shouldShowConfigField("command_allowlist_exact")).toBe(true);
  });

  it("mantém escondida a lista por categoria", () => {
    // Editar categoria à mão libera todo um tipo de comando de uma vez.
    expect(shouldShowConfigField("command_allowlist")).toBe(false);
  });

  it("tem rótulo e descrição em português", () => {
    expect(getConfigFieldLabel("command_allowlist_exact")).toBe(
      "Comandos sempre permitidos",
    );
    expect(
      getConfigFieldDescription("command_allowlist_exact", { type: "lines" }),
    ).toContain("texto exato");
  });
});

describe("shouldShowConfigField — user persona fields", () => {
  it.each(PERSONA_FIELDS)("shows %s", (key) => {
    expect(shouldShowConfigField(key)).toBe(true);
  });

  it.each(HIDDEN_PERSONA_DETAIL_FIELDS)(
    "hides companion detail field %s (synced from the select)",
    (key) => {
      expect(shouldShowConfigField(key)).toBe(false);
    },
  );

  it("hides the opaque user_id (not meant for manual editing)", () => {
    expect(shouldShowConfigField("user.user_id")).toBe(false);
  });

  it("hides user.email (dropped — unnecessary for the persona)", () => {
    expect(shouldShowConfigField("user.email")).toBe(false);
  });
});

describe("select-driven persona fields", () => {
  it("renders personality and behavior as selects with the user's real saved values as valid options", () => {
    const schema = normalizeConfigSchema({
      "user.personality": { type: "string", category: "user" },
      "user.behavior": { type: "string", category: "user" },
    });

    expect(schema["user.personality"].type).toBe("select");
    expect(schema["user.personality"].options).toContain("casual");

    expect(schema["user.behavior"].type).toBe("select");
    expect(schema["user.behavior"].options).toContain("sob_demanda");

    expect(schema["user.personality_description"]).toBeUndefined();
    expect(schema["user.behavior_description"]).toBeUndefined();
  });

  it("gives slug-style options friendly pt-BR labels with the detail inline", () => {
    expect(getConfigOptionLabel("user.personality", "casual")).toContain(
      "Casual",
    );
    expect(getConfigOptionLabel("user.personality", "casual")).toContain(
      "leve",
    );
    expect(getConfigOptionLabel("user.behavior", "sob_demanda")).toContain(
      "Sob demanda",
    );
  });
});

describe("withPersonaCompanion", () => {
  it("fills personality_description when personality changes", () => {
    const next = withPersonaCompanion(
      { user: { nickname: "Chefe" } },
      "user.personality",
      "casual",
      setNestedValue,
    );
    const user = next.user as Record<string, unknown>;
    expect(user.personality).toBe("casual");
    expect(user.personality_description).toBe(
      PERSONA_DESCRIPTION_BY_VALUE["user.personality"].casual,
    );
  });

  it("fills behavior_description when behavior changes", () => {
    const next = withPersonaCompanion(
      { user: {} },
      "user.behavior",
      "sob_demanda",
      setNestedValue,
    );
    const user = next.user as Record<string, unknown>;
    expect(user.behavior).toBe("sob_demanda");
    expect(user.behavior_description).toBe(
      PERSONA_DESCRIPTION_BY_VALUE["user.behavior"].sob_demanda,
    );
  });

  it("clears the companion description when the select is reset", () => {
    const next = withPersonaCompanion(
      {
        user: {
          personality: "casual",
          personality_description: "Leve, amigável, simples e fácil de entender.",
        },
      },
      "user.personality",
      "",
      setNestedValue,
    );
    const user = next.user as Record<string, unknown>;
    expect(user.personality).toBe("");
    expect(user.personality_description).toBe("");
  });

  it("does not touch companion fields for unrelated keys", () => {
    const next = withPersonaCompanion(
      { user: { nickname: "Chefe" } },
      "user.nickname",
      "Dev",
      setNestedValue,
    );
    const user = next.user as Record<string, unknown>;
    expect(user.nickname).toBe("Dev");
    expect(user.personality_description).toBeUndefined();
  });
});

describe("normalizeConfigSchema — user persona category", () => {
  it("remaps the backend's raw 'user' category to the dashboard 'profile' tab", () => {
    // Shape mirrors what GET /api/config/schema actually returns for
    // config.user.* fields: category comes back as the raw top-level key.
    const backendSchema = Object.fromEntries(
      PERSONA_FIELDS.map((key) => [
        key,
        { type: "string", description: key, category: "user" },
      ]),
    );

    const visible = normalizeConfigSchema(backendSchema);

    for (const key of PERSONA_FIELDS) {
      expect(visible[key], `${key} should survive normalization`).toBeDefined();
      expect(visible[key].category).toBe(PROFILE_CATEGORY);
    }
  });

  it("drops user.user_id even if the backend schema includes it", () => {
    const visible = normalizeConfigSchema({
      "user.user_id": { type: "string", category: "user" },
      "user.nickname": { type: "string", category: "user" },
    });

    expect(visible["user.user_id"]).toBeUndefined();
    expect(visible["user.nickname"]).toBeDefined();
  });
});

describe("config navigation groups", () => {
  it("Preferências reúne o que afeta a apresentação para você", () => {
    const prefs = CONFIG_NAV_GROUPS.find((g) => g.label === "Preferências");
    expect(prefs?.categories).toEqual([
      "general",
      PROFILE_CATEGORY,
      "display",
      "notifications",
      AUDIO_CATEGORY,
      "eco",
      "permissions",
    ]);
    expect(prefs?.categories).not.toContain(APPEARANCE_CATEGORY);
  });

  it("Agente reúne o que governa o que ele pode fazer", () => {
    const agente = CONFIG_NAV_GROUPS.find((g) => g.label === "Agente");
    // Segurança é aprovação de comando — governa o agente, não privacidade.
    expect(agente?.categories).toContain("security");
  });

  it("não sobra grupo criado só para acomodar o resto", () => {
    // "Privacidade e áudio" juntava dois itens sem parentesco.
    expect(CONFIG_NAV_GROUPS.map((g) => g.label)).toEqual([
      "Preferências",
      "Agente",
    ]);
  });

  it("toda categoria aparece em exatamente um grupo", () => {
    const todas = CONFIG_NAV_GROUPS.flatMap((g) => g.categories);
    expect(new Set(todas).size).toBe(todas.length);
  });
});

describe("shouldShowConfigField — copiloto do Eco", () => {
  it("mostra estilo e instruções do copiloto ao vivo", () => {
    expect(shouldShowConfigField("eco.live_assist.style")).toBe(true);
    expect(shouldShowConfigField("eco.live_assist.instructions")).toBe(true);
    expect(getConfigFieldLabel("eco.live_assist.style")).toBe(
      "Estilo do copiloto",
    );
    expect(getConfigOptionLabel("eco.live_assist.style", "curto")).toContain(
      "Curto",
    );
  });

  it("normaliza os campos na categoria eco", () => {
    const visible = normalizeConfigSchema({
      "eco.live_assist.style": { type: "string", category: "eco" },
      "eco.live_assist.instructions": { type: "string", category: "eco" },
    });
    expect(visible["eco.live_assist.style"]?.type).toBe("select");
    expect(visible["eco.live_assist.style"]?.category).toBe("eco");
    expect(visible["eco.live_assist.instructions"]?.type).toBe("text");
  });
});

describe("navegação de Configurações — aba Eco", () => {
  it("mantém Eco na sidebar mesmo com schema vazio", () => {
    expect(collectConfigNavCategories({})).toEqual(
      expect.arrayContaining(["eco", "permissions"]),
    );
  });

  it("não redireciona /config/eco enquanto o schema carrega", () => {
    expect(shouldFillConfigCategoryUrl("eco", [], false)).toBe(false);
    expect(
      resolveActiveConfigCategory({
        requested: "eco",
        available: ["permissions"],
        schemaReady: false,
        fallbackInternal: "",
      }),
    ).toBe("eco");
  });

  it("depois do schema, /config/eco permanece em Eco", () => {
    const available = collectConfigNavCategories({
      "eco.live_assist.style": { type: "select", category: "eco" },
    });
    expect(available).toContain("eco");
    expect(shouldFillConfigCategoryUrl("eco", available, true)).toBe(false);
    expect(
      resolveActiveConfigCategory({
        requested: "eco",
        available,
        schemaReady: true,
        fallbackInternal: "",
      }),
    ).toBe("eco");
  });
});
