import type { ComponentType } from "react";
import {
  ArrowLeftRight,
  Bell,
  Bot,
  Brain,
  Cpu,
  Database,
  Eye,
  Globe,
  Headphones,
  Inbox,
  Languages,
  Layers,
  Lock,
  MessageCircle,
  Mic,
  NotebookPen,
  Package,
  Palette,
  Plug,
  Puzzle,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  Sparkles,
  AudioLines,
  Terminal as TerminalIcon,
  User,
  Users,
  Volume2,
  Wrench,
} from "lucide-react";

export type ConfigFieldSchema = Record<string, unknown>;
export type ConfigSchema = Record<string, ConfigFieldSchema>;

export type ConfigIconWeight =
  "thin" | "light" | "regular" | "bold" | "fill" | "duotone";

export interface ConfigIconProps {
  className?: string;
  weight?: ConfigIconWeight;
}

type IconComponent = ComponentType<ConfigIconProps>;

const DEDICATED_CONFIG_FIELDS = new Set<string>(["model"]);

const COMMON_USER_CONFIG_FIELDS = new Set<string>([
  "timezone",

  // Persona local (config.user.*) — editada em Preferências → Perfil.
  // Fora da lista: user.user_id (id opaco) e user.email (desnecessário).
  // personality_description / behavior_description são preenchidos
  // automaticamente ao escolher personalidade / iniciativa (não aparecem na UI).
  "user.nickname",
  "user.personality",
  "user.behavior",
  "user.custom_instructions",
  "user.timezone",

  "terminal.backend",
  "terminal.cwd",
  "terminal.timeout",
  "terminal.persistent_shell",

  "dashboard.smart_menu",
  "display.show_reasoning",
  "display.show_cost",
  "display.inicio_suggestions",

  // Aba Notificações (avisos + sincronização em segundo plano).
  "dashboard.notifications.on_complete",
  "dashboard.notifications.on_approval",
  "dashboard.notifications.on_new_mail",
  "dashboard.background.mail_sync_enabled",
  "dashboard.background.mail_sync_interval_seconds",

  "privacy.redact_pii",
  "approvals.mode",
  // Fica junto de `approvals.mode` porque é a mesma decisão vista de outro
  // ângulo: o modo diz QUANDO perguntar, a lista diz o que já não precisa.
  "command_allowlist_exact",
  "security.allow_private_urls",
  "security.redact_secrets",

  "voice.max_recording_seconds",
  "voice.auto_tts",

  "tts.provider",
  "tts.edge.voice",
  "tts.elevenlabs.voice_id",
  "tts.elevenlabs.model_id",
  "tts.openai.model",
  "tts.openai.voice",
  "tts.xai.voice_id",
  "tts.xai.language",
  "tts.mistral.model",
  "tts.mistral.voice_id",
  "tts.neutts.ref_audio",
  "tts.neutts.ref_text",
  "tts.neutts.model",
  "tts.neutts.device",

  "stt.enabled",
  "stt.provider",
  "stt.local.model",
  "stt.local.language",
  "stt.openai.model",
  "stt.mistral.model",

  "eco.live_assist.style",
  "eco.live_assist.instructions",
]);

const HIDDEN_CONFIG_FIELDS = new Set<string>([
  "credential_pool_strategies",
  "fallback_providers",
  "toolsets",
  "prefill_messages_file",
  "dashboard.theme",
  "agent.gateway_timeout",
  "agent.restart_drain_timeout",
  "agent.gateway_timeout_warning",
  "agent.gateway_notify_interval",
  "command_allowlist",
  "quick_commands",
  "hooks",
  "hooks_auto_accept",
  "personalities",
  "display.tui_compact",
  "display.resume_display",
  "display.final_response_markdown",
  "display.personality",
  "display.skin",
  "display.streaming",
  "display.inline_diffs",
  "display.busy_interrupt_ask_home_channel",
  "display.user_message_preview.first_lines",
  "display.user_message_preview.last_lines",
  "display.interim_assistant_messages",
  "display.tool_progress_command",
  "display.tool_preview_length",
  "display.tool_progress_overrides",
  "display.platforms",
  "voice.record_key",
  "display.presence_nudge.enabled",
  "display.presence_nudge.idle_hours",
  "display.presence_nudge.check_interval_seconds",
  "display.presence_nudge.message",
  "human_delay.mode",
  "human_delay.min_ms",
  "human_delay.max_ms",
  // Opaque local id — not meant to be hand-edited.
  "user.user_id",
  // Synced from personality / behavior selects — not edited separately.
  "user.personality_description",
  "user.behavior_description",
]);

const HIDDEN_CONFIG_PREFIXES = [
  "bedrock.",
  "cron.",
  "sessions.",
  "onboarding.",
  "updates.",
  "checkpoints.",
  "telegram.",
  "slack.",
  "whatsapp.",
  "memory.",
] as const;

const HIDDEN_CONFIG_SUFFIXES = [".api_key"] as const;

/** Dashboard-only category for theme (not in config.yaml). */
export const APPEARANCE_CATEGORY = "appearance";

/** Local persona (config.user.*) — Preferências → Perfil. */
export const PROFILE_CATEGORY = "profile";

/** Merged voice + TTS + STT settings. */
export const AUDIO_CATEGORY = "audio";

/**
 * Virtual category for the Model & Provider picker (not in backend schema).
 */
export const MODEL_PROVIDER_CATEGORY = "model_provider";

/**
 * When the user picks a persona/initiative preset, fill the companion
 * description field used by the prompt builder (hidden from the UI).
 */
export const PERSONA_DESCRIPTION_BY_VALUE: Readonly<
  Record<"user.personality" | "user.behavior", Readonly<Record<string, string>>>
> = {
  "user.personality": {
    profissional: "Direto, técnico, objetivo e focado em resultados.",
    estrategico:
      "Analítico, questionador, com visão de negócio e planejamento.",
    casual: "Leve, amigável, simples e fácil de entender.",
  },
  "user.behavior": {
    proativo:
      "Antecipo próximos passos e ajo quando o benefício é claro, sem esperar pedido explícito.",
    equilibrado: "Respondo o pedido e sugiro algo extra quando realmente útil.",
    sob_demanda: "Respondo apenas o que for solicitado, sem extrapolar.",
    conservador:
      "Prefiro confirmar antes de ações que alterem estado ou tenham risco.",
  },
};

export const PERSONA_COMPANION_FIELD: Readonly<
  Record<"user.personality" | "user.behavior", string>
> = {
  "user.personality": "user.personality_description",
  "user.behavior": "user.behavior_description",
};

/** Apply a field change and, for persona selects, sync the hidden companion. */
export function withPersonaCompanion(
  config: Record<string, unknown>,
  schemaKey: string,
  value: unknown,
  setNested: (
    obj: Record<string, unknown>,
    path: string,
    value: unknown,
  ) => Record<string, unknown>,
): Record<string, unknown> {
  const next = setNested(config, schemaKey, value);
  if (schemaKey !== "user.personality" && schemaKey !== "user.behavior") {
    return next;
  }
  const companion = PERSONA_COMPANION_FIELD[schemaKey];
  const descriptions = PERSONA_DESCRIPTION_BY_VALUE[schemaKey];
  const slug = String(value ?? "");
  const description = descriptions[slug] ?? "";
  return setNested(next, companion, description);
}

export const CONFIG_CATEGORY_OVERRIDES: Record<string, string> = {
  model_context_length: "model_catalog",
  "dashboard.smart_menu": "display",
  timezone: "general",
};

/** Remap backend schema categories to dashboard sidebar tabs. */
const DASHBOARD_CATEGORY_REMAP: Record<string, string> = {
  voice: AUDIO_CATEGORY,
  tts: AUDIO_CATEGORY,
  stt: AUDIO_CATEGORY,
  privacy: "security",
  approvals: "security",
  context: "display",
  // Persona fields (config.user.*) — Preferências → Perfil.
  user: PROFILE_CATEGORY,
};

/** Sidebar order (dashboard only). */
export const DASHBOARD_CATEGORY_ORDER: readonly string[] = [
  "general",
  PROFILE_CATEGORY,
  "display",
  "notifications",
  // "proativo" foi REMOVIDO por completo (modo proativo desligado): sem categoria,
  // sem campos de schema, sem app. Nada roda em segundo plano.
  AUDIO_CATEGORY,
  "eco",
  "notas",
  "permissions",
  MODEL_PROVIDER_CATEGORY,
  "delegation",
  "terminal",
  "security",
] as const;

/**
 * Abas que existem na sidebar mesmo sem campos no schema (conteúdo próprio
 * ou deep-link de outro app). Sem isto, `/config/eco` caía em Permissões
 * enquanto o schema ainda carregava — o Eco some da lista e o efeito de
 * “categoria inválida” redireciona.
 */
export const SCHEMA_INDEPENDENT_CATEGORIES: readonly string[] = [
  MODEL_PROVIDER_CATEGORY,
  "permissions",
  "eco",
];

export function collectConfigNavCategories(visibleSchema: ConfigSchema): string[] {
  const fromSchema = new Set(
    Object.values(visibleSchema).map((s) => String(s.category || "general")),
  );
  for (const cat of SCHEMA_INDEPENDENT_CATEGORIES) {
    fromSchema.add(cat);
  }
  return DASHBOARD_CATEGORY_ORDER.filter((c) => fromSchema.has(c));
}

/** Qual aba pintar: honra o deep-link até o schema chegar. */
export function resolveActiveConfigCategory(opts: {
  requested: string | undefined;
  available: readonly string[];
  schemaReady: boolean;
  fallbackInternal: string;
}): string {
  const { requested, available, schemaReady, fallbackInternal } = opts;
  if (requested && (available.includes(requested) || !schemaReady)) {
    return requested;
  }
  if (available.length === 0) return requested ?? fallbackInternal;
  if (!requested && fallbackInternal && available.includes(fallbackInternal)) {
    return fallbackInternal;
  }
  return available[0] ?? requested ?? fallbackInternal;
}

/** Só preenche/corrige a URL depois que o schema chegou. */
export function shouldFillConfigCategoryUrl(
  requested: string | undefined,
  available: readonly string[],
  schemaReady: boolean,
): boolean {
  if (!schemaReady || available.length === 0) return false;
  if (!requested) return true;
  return !available.includes(requested);
}

export interface ConfigNavGroup {
  label: string;
  categories: readonly string[];
}

/**
 * Dois grupos, separados por QUEM a configuração afeta.
 *
 * Antes eram três, e o terceiro se chamava "Privacidade e áudio" — um rótulo
 * que existe só porque sobraram dois itens sem parentesco. Segurança é
 * aprovação de comando: governa o que o AGENTE pode fazer, não privacidade.
 * Áudio é preferência de apresentação, igual a tema e fonte.
 *
 * Realocados: Segurança vai para "Agente" (é o que ela controla) e Áudio
 * para "Preferências" (é como a coisa se apresenta a você).
 */
export const CONFIG_NAV_GROUPS: readonly ConfigNavGroup[] = [
  {
    label: "Preferências",
    categories: [
      "general",
      PROFILE_CATEGORY,
      "display",
      "notifications",
      AUDIO_CATEGORY,
      "eco",
      "permissions",
    ],
  },
  {
    // Delegação virou um card dentro de "Modelo & Provedor" — não é mais aba.
    label: "Agente",
    categories: [MODEL_PROVIDER_CATEGORY, "terminal", "security"],
  },
];

export interface ConfigFieldSection {
  id: string;
  label: string;
  description?: string;
  match: (schemaKey: string) => boolean;
}

// Só os RÓTULOS de seção (divisores para escanear categorias com vários
// campos). As descrições de grupo foram removidas por repetirem o que os
// próprios campos já dizem — menos ruído, como pedido.
export const CONFIG_FIELD_SECTIONS: Partial<
  Record<string, readonly ConfigFieldSection[]>
> = {
  [PROFILE_CATEGORY]: [
    {
      id: "identity",
      label: "Identidade",
      match: (key) => key === "user.nickname" || key === "user.timezone",
    },
    {
      id: "style",
      label: "Estilo e iniciativa",
      match: (key) => key === "user.personality" || key === "user.behavior",
    },
  ],
  // "general": sem seções — Tema/Fundo transparente/Fuso horário já se rotulam.
  [AUDIO_CATEGORY]: [
    {
      id: "voice-web",
      label: "Gravação no chat web",
      match: (key) => key === "voice.max_recording_seconds",
    },
    {
      id: "voice-auto-tts",
      label: "Fala automática",
      match: (key) => key === "voice.auto_tts",
    },
    {
      id: "tts",
      label: "Texto para fala",
      match: (key) => key.startsWith("tts."),
    },
    {
      id: "stt",
      label: "Fala para texto",
      match: (key) => key.startsWith("stt."),
    },
  ],
  eco: [
    {
      id: "eco-live",
      label: "Copiloto ao vivo",
      match: (key) => key.startsWith("eco.live_assist."),
    },
  ],
  security: [
    {
      id: "approvals",
      label: "Aprovações",
      match: (key) => key.startsWith("approvals."),
    },
    {
      id: "privacy",
      label: "Privacidade",
      match: (key) => key.startsWith("privacy."),
    },
    {
      id: "security-core",
      label: "Rede e segredos",
      match: (key) => key.startsWith("security."),
    },
  ],
  notifications: [
    {
      id: "notif-alerts",
      label: "Avisos",
      match: (key) => key.startsWith("dashboard.notifications."),
    },
    {
      id: "notif-sync",
      label: "Sincronização em segundo plano",
      match: (key) => key.startsWith("dashboard.background."),
    },
  ],
  display: [
    {
      id: "display-chat",
      label: "Interface do chat",
      match: (key) =>
        key.startsWith("display.") || key === "dashboard.smart_menu",
    },
    {
      id: "display-context",
      label: "Contexto da conversa",
      match: (key) => key.startsWith("context."),
    },
  ],
  terminal: [
    {
      id: "terminal-core",
      label: "Execução",
      match: (key) =>
        key.startsWith("terminal.") &&
        !key.startsWith("terminal.docker_") &&
        !key.startsWith("terminal.singularity_") &&
        !key.startsWith("terminal.modal_") &&
        !key.startsWith("terminal.daytona_") &&
        !key.startsWith("terminal.container_"),
    },
    {
      id: "terminal-containers",
      label: "Contêineres",
      match: (key) =>
        key.startsWith("terminal.docker_") ||
        key.startsWith("terminal.singularity_") ||
        key.startsWith("terminal.modal_") ||
        key.startsWith("terminal.daytona_") ||
        key.startsWith("terminal.container_"),
    },
  ],
};

function resolveDashboardCategory(
  schemaKey: string,
  rawCategory: string,
): string {
  if (CONFIG_CATEGORY_OVERRIDES[schemaKey]) {
    return CONFIG_CATEGORY_OVERRIDES[schemaKey];
  }
  const topLevel = schemaKey.split(".")[0];
  return (
    DASHBOARD_CATEGORY_REMAP[rawCategory] ??
    DASHBOARD_CATEGORY_REMAP[topLevel] ??
    rawCategory
  );
}

const DISPLAY_FIELD_ORDER: Record<string, number> = {
  "dashboard.smart_menu": 30,
  "display.show_reasoning": 40,
  "display.show_cost": 50,
};

const PROFILE_FIELD_ORDER: Record<string, number> = {
  "user.nickname": 0,
  "user.timezone": 10,
  "user.personality": 20,
  "user.behavior": 30,
  "user.custom_instructions": 40,
};

export function sortConfigFieldsForCategory(
  category: string,
  entries: [string, ConfigFieldSchema][],
): [string, ConfigFieldSchema][] {
  const orderMap =
    category === "display"
      ? DISPLAY_FIELD_ORDER
      : category === PROFILE_CATEGORY
        ? PROFILE_FIELD_ORDER
        : null;
  if (!orderMap) return entries;
  return [...entries].sort((a, b) => {
    const orderA = orderMap[a[0]] ?? 1000;
    const orderB = orderMap[b[0]] ?? 1000;
    if (orderA !== orderB) return orderA - orderB;
    return a[0].localeCompare(b[0]);
  });
}

export function groupConfigFields(
  category: string,
  entries: [string, ConfigFieldSchema][],
): {
  section: ConfigFieldSection | null;
  fields: [string, ConfigFieldSchema][];
}[] {
  const sections = CONFIG_FIELD_SECTIONS[category];
  if (!sections?.length) {
    return [{ section: null, fields: entries }];
  }

  const buckets = sections.map((section) => ({
    section,
    fields: [] as [string, ConfigFieldSchema][],
  }));
  const remainder: [string, ConfigFieldSchema][] = [];

  for (const entry of entries) {
    const bucket = buckets.find(({ section }) => section.match(entry[0]));
    if (bucket) bucket.fields.push(entry);
    else remainder.push(entry);
  }

  const grouped: {
    section: ConfigFieldSection | null;
    fields: [string, ConfigFieldSchema][];
  }[] = buckets.filter(({ fields }) => fields.length > 0);
  if (remainder.length > 0) {
    grouped.push({ section: null, fields: remainder });
  }
  return grouped;
}

const FIELD_SCHEMA_OVERRIDES: Record<string, ConfigFieldSchema> = {
  timezone: {
    type: "select",
    options: [
      "",
      "America/Sao_Paulo",
      "America/Fortaleza",
      "America/Manaus",
      "America/Belem",
      "America/Recife",
      "America/Bahia",
      "America/Campo_Grande",
      "America/Cuiaba",
      "America/Rio_Branco",
      "UTC",
      "America/New_York",
      "America/Los_Angeles",
      "Europe/London",
      "Europe/Lisbon",
      "Europe/Paris",
      "Asia/Tokyo",
    ],
  },
  "user.custom_instructions": {
    type: "text",
  },
  "user.personality": {
    type: "select",
    options: ["", "profissional", "estrategico", "casual"],
  },
  "user.behavior": {
    type: "select",
    options: ["", "proativo", "equilibrado", "sob_demanda", "conservador"],
  },
  "user.timezone": {
    type: "select",
    options: [
      "",
      "America/Sao_Paulo",
      "America/Fortaleza",
      "America/Manaus",
      "America/Belem",
      "America/Recife",
      "America/Bahia",
      "America/Campo_Grande",
      "America/Cuiaba",
      "America/Rio_Branco",
      "UTC",
      "America/New_York",
      "America/Los_Angeles",
      "Europe/London",
      "Europe/Lisbon",
      "Europe/Paris",
      "Asia/Tokyo",
    ],
  },
  "terminal.modal_mode": {
    type: "select",
    options: ["auto", "direct", "managed"],
  },
  "browser.dialog_policy": {
    type: "select",
    options: ["must_respond", "auto_dismiss", "auto_accept"],
  },
  "approvals.mode": {
    type: "select",
    options: ["manual", "smart", "off"],
  },
  "prompt_caching.cache_ttl": {
    type: "select",
    options: ["5m", "1h"],
  },
  "tts.provider": {
    type: "select",
    options: [
      "edge",
      "openai",
      "elevenlabs",
      "mistral",
      "xai",
      "minimax",
      "gemini",
      "neutts",
      "kittentts",
    ],
  },
  "tts.edge.voice": {
    type: "select",
    options: [
      "pt-BR-FranciscaNeural",
      "pt-BR-AntonioNeural",
      "pt-BR-ThalitaNeural",
      "en-US-JennyNeural",
      "en-US-GuyNeural",
      "es-ES-ElviraNeural",
      "es-MX-DaliaNeural",
    ],
  },
  "tts.elevenlabs.model_id": {
    type: "select",
    options: [
      "eleven_multilingual_v2",
      "eleven_turbo_v2_5",
      "eleven_flash_v2_5",
      "eleven_v3",
    ],
  },
  "tts.openai.model": {
    type: "select",
    options: ["gpt-4o-mini-tts", "tts-1", "tts-1-hd"],
  },
  "tts.openai.voice": {
    type: "select",
    options: [
      "alloy",
      "ash",
      "ballad",
      "coral",
      "echo",
      "fable",
      "nova",
      "onyx",
      "sage",
      "shimmer",
    ],
  },
  "tts.xai.voice_id": {
    type: "select",
    options: ["eve", "dan", "jensen"],
  },
  "tts.xai.language": {
    type: "select",
    options: ["pt", "pt-BR", "en", "es", "fr", "de", "it", "ja", "ko", "zh"],
  },
  "tts.mistral.model": {
    type: "select",
    options: ["voxtral-mini-tts-2603"],
  },
  "tts.neutts.model": {
    type: "select",
    options: ["neuphonic/neutts-air-q4-gguf"],
  },
  "tts.neutts.device": {
    type: "select",
    options: ["cpu", "mps", "cuda"],
  },
  "stt.provider": {
    type: "select",
    options: ["local", "openai", "mistral", "groq"],
  },
  "stt.local.model": {
    type: "select",
    options: ["tiny", "base", "small", "medium", "large-v3"],
  },
  "stt.local.language": {
    type: "select",
    options: [
      "pt",
      "pt-BR",
      "",
      "auto",
      "en",
      "es",
      "fr",
      "de",
      "it",
      "ja",
      "ko",
      "zh",
    ],
  },
  "stt.openai.model": {
    type: "select",
    options: ["whisper-1", "gpt-4o-transcribe", "gpt-4o-mini-transcribe"],
  },
  "stt.mistral.model": {
    type: "select",
    options: ["voxtral-mini-latest", "voxtral-mini-2602"],
  },
  "eco.live_assist.style": {
    type: "select",
    options: ["curto", "equilibrado", "detalhado"],
  },
  "eco.live_assist.instructions": {
    type: "text",
  },
};

const CATEGORY_ICONS: Record<string, IconComponent> = {
  [MODEL_PROVIDER_CATEGORY]: Cpu,
  [APPEARANCE_CATEGORY]: Palette,
  [PROFILE_CATEGORY]: User,
  general: Settings,
  agent: Bot,
  terminal: TerminalIcon,
  display: Eye,
  delegation: Users,
  compression: Layers,
  security: Shield,
  permissions: ShieldCheck,
  browser: Globe,
  [AUDIO_CATEGORY]: Headphones,
  eco: AudioLines,
  voice: Mic,
  tts: Volume2,
  stt: Mic,
  logging: Layers,
  auxiliary: Sparkles,
  model_catalog: Cpu,
  prompt_caching: Database,
  rag: Search,
  tool_output: Inbox,
  tools: Wrench,
  web: Globe,
  chat: MessageCircle,
  api: Plug,
  gateway: ArrowLeftRight,
  skills: Package,
  plugins: Puzzle,
  notifications: Bell,
  notas: NotebookPen,
  privacy: Lock,
  approvals: ShieldCheck,
  accessibility: Eye,
  language: Languages,
  network: Globe,
  storage: Database,
  shortcuts: Wrench,
  integrations: Puzzle,
  accounts: Users,
  billing: Database,
  performance: Sparkles,
  context: Brain,
};

const CATEGORY_LABELS: Record<string, string> = {
  [MODEL_PROVIDER_CATEGORY]: "Modelo & Provedor",
  [APPEARANCE_CATEGORY]: "Aparência",
  [PROFILE_CATEGORY]: "Perfil",
  [AUDIO_CATEGORY]: "Áudio",
  eco: "Eco",
  general: "Geral",
  agent: "Agente",
  terminal: "Execução de comandos",
  display: "Chat & exibição",
  delegation: "Delegação",
  memory: "Memória",
  compression: "Compressão",
  security: "Segurança",
  browser: "Navegador",
  voice: "Voz",
  tts: "Texto para fala",
  stt: "Fala para texto",
  logging: "Registro",
  auxiliary: "Modelos auxiliares",
  model_catalog: "Modelo e provedores",
  prompt_caching: "Cache de prompt",
  rag: "Busca em histórico",
  tool_output: "Saída das ferramentas",
  tools: "Ferramentas",
  web: "Web",
  chat: "Chat",
  api: "API",
  gateway: "Gateway",
  skills: "Skills",
  plugins: "Plugins",
  notifications: "Notificações",
  notas: "Notas",
  permissions: "Permissões do sistema",
  performance: "Desempenho",
  network: "Rede",
  storage: "Armazenamento",
  privacy: "Privacidade",
  accessibility: "Acessibilidade",
  language: "Idioma",
  shortcuts: "Atalhos",
  integrations: "Integrações",
  accounts: "Contas",
  billing: "Faturamento",
};

const FIELD_LABELS: Record<string, string> = {
  file_read_max_chars: "Limite de leitura de arquivo",
  timezone: "Fuso horário",
  model_context_length: "Janela de contexto",

  // Aba Notificações
  "dashboard.notifications.on_complete": "Turno concluído",
  "dashboard.notifications.on_approval": "Aprovação ou pergunta",
  "dashboard.notifications.on_new_mail": "E-mail novo",
  "dashboard.background.mail_sync_enabled": "Sincronizar e-mail em segundo plano",
  "dashboard.background.mail_sync_interval_seconds": "Intervalo de checagem (segundos)",

  "user.nickname": "Como te chamar",
  "user.personality": "Personalidade",
  "user.behavior": "Nível de iniciativa",
  "user.custom_instructions": "Instruções adicionais",
  "user.timezone": "Seu fuso horário",

  "agent.max_turns": "Máximo de turnos",
  "agent.api_max_retries": "Tentativas da API",
  "agent.service_tier": "Nível de serviço",
  "agent.tool_use_enforcement": "Forçar uso de ferramentas",

  "terminal.backend": "Onde executar",
  "terminal.modal_mode": "Modo do Modal",
  "terminal.cwd": "Pasta padrão",
  "terminal.timeout": "Tempo limite por comando",
  "terminal.env_passthrough": "Variáveis permitidas",
  "terminal.shell_init_files": "Arquivos de inicialização",
  "terminal.auto_source_bashrc": "Carregar bashrc automaticamente",
  "terminal.docker_image": "Imagem Docker",
  "terminal.docker_forward_env": "Repassar ambiente ao Docker",
  "terminal.singularity_image": "Imagem Singularity",
  "terminal.modal_image": "Imagem Modal",
  "terminal.daytona_image": "Imagem Daytona",
  "terminal.container_cpu": "CPU do contêiner",
  "terminal.container_memory": "Memória do contêiner",
  "terminal.container_disk": "Disco do contêiner",
  "terminal.container_persistent": "Contêiner persistente",
  "terminal.docker_volumes": "Volumes Docker",
  "terminal.docker_mount_cwd_to_workspace": "Montar diretório no workspace",
  "terminal.persistent_shell": "Manter o shell entre comandos",

  command_allowlist_exact: "Comandos sempre permitidos",
  "display.show_reasoning": "Mostrar raciocínio",
  "display.show_cost": "Mostrar custo",
  "display.inicio_suggestions": "Sugestões inteligentes na tela inicial",

  "compression.enabled": "Compressão ativa",
  "compression.threshold": "Limite para comprimir",
  "compression.target_ratio": "Proporção alvo",
  "compression.protect_last_n": "Mensagens recentes protegidas",

  "memory.memory_enabled": "Memória ativa",
  "memory.user_profile_enabled": "Perfil do usuário ativo",
  "memory.memory_char_limit": "Limite da memória",
  "memory.user_char_limit": "Limite do perfil",
  "memory.provider": "Plugin de memória",

  "rag.enabled": "Busca no histórico ativa",
  "rag.max_results": "Máximo de resultados",
  "rag.max_chars": "Máximo de caracteres",
  "rag.min_query_chars": "Consulta mínima",

  // Delegação: campos editados pelo card custom (DelegationCard), não pelo
  // formulário por schema — sem rótulos aqui.

  "browser.inactivity_timeout": "Tempo limite de inatividade",
  "browser.command_timeout": "Tempo limite de comando",
  "browser.record_sessions": "Gravar sessões",
  "browser.allow_private_urls": "Permitir URLs privadas",
  "browser.auto_local_for_private_urls":
    "Usar navegador local para URLs privadas",
  "browser.cdp_url": "URL CDP",
  "browser.dialog_policy": "Política de diálogos",
  "browser.dialog_timeout_s": "Tempo limite de diálogo",
  "browser.camofox.managed_persistence": "Persistência gerenciada do Camofox",

  "privacy.redact_pii": "Ocultar dados pessoais",
  "approvals.mode": "Modo de aprovação",
  "approvals.timeout": "Tempo limite de aprovação",
  "approvals.cron_mode": "Aprovação em tarefas agendadas",
  "security.allow_private_urls": "Permitir URLs privadas",
  "security.redact_secrets": "Ocultar segredos",
  "security.tirith_enabled": "Scanner Tirith ativo",
  "security.tirith_path": "Caminho do Tirith",
  "security.tirith_timeout": "Tempo limite do Tirith",
  "security.tirith_fail_open": "Permitir em falha do Tirith",
  "security.website_blocklist.enabled": "Bloqueio de sites ativo",
  "security.website_blocklist.domains": "Domínios bloqueados",
  "security.website_blocklist.shared_files": "Arquivos de bloqueio",

  "logging.level": "Nível de log",
  "logging.max_size_mb": "Tamanho máximo do log",
  "logging.backup_count": "Backups de log",

  "tool_output.max_bytes": "Máximo de bytes",
  "tool_output.max_lines": "Máximo de linhas",
  "tool_output.max_line_length": "Tamanho máximo da linha",

  "prompt_caching.cache_ttl": "Duração do cache",

  "context.engine": "Motor de contexto",
  "skills.external_dirs": "Diretórios externos de habilidades",
  "skills.template_vars": "Variáveis de template",
  "skills.inline_shell": "Executar shell inline",
  "skills.inline_shell_timeout": "Tempo limite do shell inline",
  "skills.guard_agent_created": "Verificar habilidades criadas pelo agente",
  "skills.creation_nudge_interval": "Intervalo para sugerir salvar skill",
  "code_execution.mode": "Modo de execução de código",
  "network.force_ipv4": "Forçar IPv4",

  "voice.max_recording_seconds": "Duração máxima da gravação",
  "voice.auto_tts": "Falar respostas automaticamente",
  "voice.silence_threshold": "Limiar de silêncio",
  "voice.silence_duration": "Duração do silêncio",

  "stt.enabled": "Transcrição ativa",
  "stt.provider": "Provedor de transcrição",
  "stt.local.model": "Modelo local",
  "stt.local.language": "Idioma local",
  "stt.openai.model": "Modelo OpenAI",
  "stt.mistral.model": "Modelo Mistral",

  "eco.live_assist.style": "Estilo do copiloto",
  "eco.live_assist.instructions": "Instruções do copiloto",

  "tts.provider": "Provedor de voz",
  "tts.edge.voice": "Voz Edge",
  "tts.elevenlabs.voice_id": "Voz ElevenLabs",
  "tts.elevenlabs.model_id": "Modelo ElevenLabs",
  "tts.openai.model": "Modelo OpenAI",
  "tts.openai.voice": "Voz OpenAI",
  "tts.xai.voice_id": "Voz xAI",
  "tts.xai.language": "Idioma xAI",
  "tts.xai.sample_rate": "Taxa de amostragem",
  "tts.xai.bit_rate": "Taxa de bits",
  "tts.mistral.model": "Modelo Mistral",
  "tts.mistral.voice_id": "Voz Mistral",
  "tts.neutts.ref_audio": "Áudio de referência",
  "tts.neutts.ref_text": "Texto de referência",
  "tts.neutts.model": "Modelo NeuTTS",
  "tts.neutts.device": "Dispositivo NeuTTS",

  "dashboard.smart_menu": "Menu Inteligente",
};

const FIELD_DESCRIPTIONS: Record<string, string> = {
  file_read_max_chars:
    "Quantidade máxima de caracteres retornada por uma leitura de arquivo.",
  timezone: "Deixe vazio para usar o fuso horário local do servidor.",

  "user.nickname": "Apelido usado pelo agente ao se dirigir a você.",
  command_allowlist_exact:
    "Comandos autorizados individualmente, por texto exato. Autorizar um não autoriza outros parecidos. Remova uma linha para revogar.",
  "user.personality":
    "Tom geral do agente. O detalhe do estilo é aplicado automaticamente ao prompt.",
  "user.behavior":
    "Quanto o agente antecipa ações. O detalhe do nível é aplicado automaticamente ao prompt.",
  "user.custom_instructions":
    "Texto livre injetado no prompt em todas as sessões.",
  "user.timezone":
    "Fuso do usuário (pode diferir do fuso do servidor em Geral).",
  "dashboard.smart_menu":
    "Recolhe automaticamente a barra lateral após 1 minuto sem uso. Só no desktop.",
  model_context_length:
    "Sobrescreve a janela de contexto. Use 0 para detectar automaticamente.",
  "agent.max_turns": "Número máximo de iterações por conversa.",
  "terminal.cwd":
    "Pasta usada quando a conversa não tem uma própria. No painel você escolhe a pasta em cada conversa (“Abrir pasta”) e ela tem prioridade; na mensageria, onde não há como escolher, vale esta.",
  "terminal.timeout":
    "Quanto um único comando pode demorar antes de ser cortado. Sobe se você roda build ou suíte de testes longa pelo agente.",
  "terminal.persistent_shell":
    "Ligado, comandos seguidos compartilham o mesmo shell — um `cd` ou uma variável exportada continuam valendo no comando seguinte.",
  "memory.provider":
    "Identificador do plugin (vazio = só memória interna). Use `super_notepad` para opções instaladas.",
  "rag.enabled":
    "Usa busca local nas conversas anteriores para enriquecer a resposta.",
  "approvals.mode": "Define como comandos perigosos são aprovados.",
  "logging.level": "Nível mínimo gravado em agent.log.",
  "tts.provider":
    "Define qual mecanismo será usado para gerar áudio a partir de texto.",
  "voice.max_recording_seconds":
    "Limite em segundos ao gravar pelo microfone no chat web (confirme com ✓ para transcrever).",
  "voice.auto_tts":
    "Fala automaticamente a última resposta do assistente nos canais e no modo de voz. Não se aplica ao chat web.",
  "stt.enabled":
    "Desative para bloquear transcrição de áudio no chat e no gateway.",
  "stt.provider":
    "Provedor padrão no gateway. No chat web, APIs com chave (Groq, OpenAI, Mistral, xAI) têm prioridade quando configuradas em /env.",
  "stt.local.model":
    "Modelo faster-whisper local; a primeira transcrição pode demorar enquanto o modelo é carregado.",
  "stt.local.language":
    "Padrão português (pt-BR). Use «Detectar automaticamente» ou «auto» para o modelo escolher o idioma.",
  "eco.live_assist.style":
    "Quão longo o copiloto fala no chat da call. Curto é o padrão — 1 ou 2 frases, sem enrolar.",
  "eco.live_assist.instructions":
    "Texto livre só para o copiloto ao vivo (tom, o que priorizar, o que nunca falar). Não altera o chat normal.",
  "skills.creation_nudge_interval":
    "A cada N chamadas de ferramenta, o agente pode revisar a conversa e salvar ou atualizar skills.",
};

const TOKEN_LABELS: Record<string, string> = {
  api: "API",
  auto: "automático",
  approve: "aprovar",
  async: "assíncrono",
  backend: "backend",
  backup: "backup",
  bytes: "bytes",
  cache: "cache",
  chars: "caracteres",
  child: "subagente",
  children: "subagentes",
  command: "comando",
  concurrent: "paralelos",
  config: "configuração",
  context: "contexto",
  cost: "custo",
  count: "quantidade",
  cwd: "diretório",
  deny: "negar",
  dirs: "diretórios",
  display: "exibição",
  download: "download",
  enabled: "ativo",
  engine: "motor",
  env: "ambiente",
  fallback: "alternativo",
  file: "arquivo",
  files: "arquivos",
  final: "final",
  force: "forçar",
  gateway: "gateway",
  guard: "proteção",
  image: "imagem",
  interval: "intervalo",
  language: "idioma",
  length: "tamanho",
  lines: "linhas",
  max: "máximo",
  memory: "memória",
  min: "mínimo",
  mode: "modo",
  model: "modelo",
  notify: "notificação",
  open: "aberto",
  output: "saída",
  passthrough: "permitidas",
  path: "caminho",
  preview: "prévia",
  provider: "provedor",
  query: "consulta",
  ratio: "proporção",
  record: "gravar",
  reasoning: "raciocínio",
  results: "resultados",
  retry: "tentativa",
  seconds: "segundos",
  service: "serviço",
  shell: "shell",
  size: "tamanho",
  snippet: "trecho",
  streaming: "streaming",
  threshold: "limite",
  timeout: "tempo limite",
  ttl: "duração",
  url: "URL",
  user: "usuário",
  voice: "voz",
};

const OPTION_LABELS: Record<string, Record<string, string>> = {
  "*": {
    "": "Padrão",
    off: "Desativado",
    on: "Ativado",
    true: "Ativado",
    false: "Desativado",
    auto: "Automático",
    default: "Padrão",
    enabled: "Ativado",
    disabled: "Desativado",
  },
  "display.resume_display": {
    minimal: "Mínimo",
    full: "Completo",
    off: "Desativado",
  },
  "display.final_response_markdown": {
    render: "Renderizar",
    strip: "Remover formatação",
    raw: "Bruto",
  },
  "user.personality": {
    profissional: "Profissional — direto, técnico, objetivo",
    estrategico: "Estratégico — analítico, visão de negócio",
    casual: "Casual — leve, amigável, fácil de entender",
  },
  "user.behavior": {
    proativo: "Proativo — antecipa e age quando faz sentido",
    equilibrado: "Equilibrado — responde e sugere o essencial",
    sob_demanda: "Sob demanda — só o que for pedido",
    conservador: "Conservador — confirma antes de ações arriscadas",
  },
  "eco.live_assist.style": {
    curto: "Curto — 1 ou 2 frases",
    equilibrado: "Equilibrado — 1 a 3 frases",
    detalhado: "Detalhado — parágrafo ou bullets",
  },
  "approvals.mode": {
    manual: "Perguntar sempre",
    smart: "Aprovação inteligente",
    off: "Sem aprovação",
  },
  "approvals.cron_mode": {
    deny: "Negar",
    approve: "Aprovar",
  },
  "human_delay.mode": {
    off: "Desativado",
    typing: "Simular digitação",
    fixed: "Atraso fixo",
  },
  "browser.dialog_policy": {
    must_respond: "Perguntar ao agente",
    auto_dismiss: "Recusar automaticamente",
    auto_accept: "Aceitar automaticamente",
  },
  "terminal.modal_mode": {
    auto: "Automático",
    direct: "Direto",
    managed: "Gerenciado",
  },
  "logging.level": {
    DEBUG: "Depuração",
    INFO: "Informação",
    WARNING: "Aviso",
    ERROR: "Erro",
  },
  timezone: {
    "": "Padrão do sistema",
    UTC: "UTC",
    "America/Sao_Paulo": "São Paulo",
    "America/Fortaleza": "Fortaleza",
    "America/Manaus": "Manaus",
    "America/Belem": "Belém",
    "America/Recife": "Recife",
    "America/Bahia": "Bahia",
    "America/Campo_Grande": "Campo Grande",
    "America/Cuiaba": "Cuiabá",
    "America/Rio_Branco": "Rio Branco",
    "America/New_York": "Nova York",
    "America/Los_Angeles": "Los Angeles",
    "Europe/London": "Londres",
    "Europe/Lisbon": "Lisboa",
    "Europe/Paris": "Paris",
    "Asia/Tokyo": "Tóquio",
  },
  "tts.provider": {
    edge: "Microsoft Edge (gratuito)",
    openai: "OpenAI",
    elevenlabs: "ElevenLabs",
    mistral: "Mistral",
    xai: "xAI",
    minimax: "MiniMax",
    gemini: "Gemini",
    neutts: "NeuTTS local",
    kittentts: "KittenTTS local",
  },
  "tts.edge.voice": {
    "pt-BR-FranciscaNeural": "Francisca (pt-BR)",
    "pt-BR-AntonioNeural": "Antonio (pt-BR)",
    "pt-BR-ThalitaNeural": "Thalita (pt-BR)",
    "en-US-JennyNeural": "Jenny (en-US)",
    "en-US-GuyNeural": "Guy (en-US)",
    "es-ES-ElviraNeural": "Elvira (es-ES)",
    "es-MX-DaliaNeural": "Dalia (es-MX)",
  },
  "tts.openai.voice": {
    alloy: "Alloy",
    ash: "Ash",
    ballad: "Ballad",
    coral: "Coral",
    echo: "Echo",
    fable: "Fable",
    nova: "Nova",
    onyx: "Onyx",
    sage: "Sage",
    shimmer: "Shimmer",
  },
  "tts.neutts.device": {
    cpu: "CPU",
    mps: "Apple Silicon (MPS)",
    cuda: "NVIDIA CUDA",
  },
  "stt.provider": {
    local: "Local",
    openai: "OpenAI",
    mistral: "Mistral",
    groq: "Groq",
  },
  "stt.local.language": {
    pt: "Português (padrão)",
    "pt-BR": "Português do Brasil",
    "": "Detectar automaticamente",
    auto: "Detectar automaticamente",
    en: "Inglês",
    es: "Espanhol",
    fr: "Francês",
    de: "Alemão",
    it: "Italiano",
    ja: "Japonês",
    ko: "Coreano",
    zh: "Chinês",
  },
};

export function shouldShowConfigField(schemaKey: string): boolean {
  if (!COMMON_USER_CONFIG_FIELDS.has(schemaKey)) {
    return false;
  }
  if (
    DEDICATED_CONFIG_FIELDS.has(schemaKey) ||
    HIDDEN_CONFIG_FIELDS.has(schemaKey)
  ) {
    return false;
  }
  if (HIDDEN_CONFIG_PREFIXES.some((prefix) => schemaKey.startsWith(prefix))) {
    return false;
  }
  return !HIDDEN_CONFIG_SUFFIXES.some((suffix) => schemaKey.endsWith(suffix));
}

export function normalizeConfigSchema(
  schema: ConfigSchema | null,
  config?: Record<string, unknown> | null,
): ConfigSchema {
  if (!schema) return {};
  return Object.fromEntries(
    Object.entries(schema)
      .filter(
        ([key]) =>
          shouldShowConfigField(key) && shouldShowContextualField(key, config),
      )
      .map(([key, fieldSchema]) => [
        key,
        {
          ...fieldSchema,
          ...FIELD_SCHEMA_OVERRIDES[key],
          category: resolveDashboardCategory(
            key,
            String(fieldSchema.category || "general"),
          ),
        },
      ]),
  );
}

function shouldShowContextualField(
  schemaKey: string,
  config?: Record<string, unknown> | null,
): boolean {
  if (schemaKey.startsWith("tts.") && schemaKey.split(".").length > 2) {
    const provider = String(readNestedConfig(config, "tts.provider") || "edge");
    return schemaKey.startsWith(`tts.${provider}.`);
  }

  if (schemaKey.startsWith("stt.") && schemaKey.split(".").length > 2) {
    const provider = String(
      readNestedConfig(config, "stt.provider") || "local",
    );
    return schemaKey.startsWith(`stt.${provider}.`);
  }

  if (schemaKey.startsWith("terminal.docker_")) {
    return readNestedConfig(config, "terminal.backend") === "docker";
  }

  if (schemaKey.startsWith("terminal.singularity_")) {
    return readNestedConfig(config, "terminal.backend") === "singularity";
  }

  if (schemaKey.startsWith("terminal.modal_")) {
    return readNestedConfig(config, "terminal.backend") === "modal";
  }

  if (schemaKey.startsWith("terminal.daytona_")) {
    return readNestedConfig(config, "terminal.backend") === "daytona";
  }

  if (schemaKey.startsWith("terminal.container_")) {
    return ["docker", "modal", "daytona", "singularity"].includes(
      String(readNestedConfig(config, "terminal.backend") || "local"),
    );
  }

  return true;
}

function readNestedConfig(
  config: Record<string, unknown> | null | undefined,
  path: string,
): unknown {
  let current: unknown = config;
  for (const part of path.split(".")) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  [APPEARANCE_CATEGORY]:
    "Tema do dashboard: escuro, claro ou conforme o sistema.",
  [PROFILE_CATEGORY]:
    "Como o agente te chama e se comporta. Aplicado ao contexto de cada conversa.",
  general: "Tema, aparência e fuso horário das sessões.",
  display: "Como mensagens, raciocínio e custos aparecem no chat.",
  [MODEL_PROVIDER_CATEGORY]:
    "Modelo principal e provedor. Chaves e URL base em /env.",
  terminal:
    "Onde os comandos do agente são executados. Vale para toda conversa — painel, app ou mensageria — e não tem relação com você usar um terminal.",
  security: "Aprovações, privacidade e proteção de URLs e segredos.",
  [AUDIO_CATEGORY]:
    "Microfone no composer web, transcrição (STT) e voz sintética (TTS).",
  eco: "Copiloto ao vivo nas gravações: tamanho da resposta e instruções extras.",
  permissions:
    "Acessos que o sistema operacional precisa liberar para o Super Notepad trabalhar em segundo plano.",
  notas: "Preferências do app Notas.",
};

export function getConfigCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? humanizeIdentifier(category);
}

export function getConfigCategoryDescription(category: string): string {
  return CATEGORY_DESCRIPTIONS[category] ?? "";
}

export function getConfigCategoryIcon(
  category: string,
): ComponentType<ConfigIconProps> {
  return CATEGORY_ICONS[category] ?? Settings;
}

export function getConfigFieldLabel(schemaKey: string): string {
  return (
    FIELD_LABELS[schemaKey] ??
    humanizeIdentifier(schemaKey.split(".").pop() ?? schemaKey)
  );
}

export function getConfigFieldDescription(
  schemaKey: string,
  schema: ConfigFieldSchema,
): string {
  const description = FIELD_DESCRIPTIONS[schemaKey];
  if (description) return description;

  const rawDescription = schema.description ? String(schema.description) : "";
  if (!rawDescription || looksAutoGeneratedDescription(rawDescription))
    return "";
  return rawDescription;
}

export function getConfigOptionLabel(schemaKey: string, value: string): string {
  return (
    OPTION_LABELS[schemaKey]?.[value] ??
    OPTION_LABELS["*"][value] ??
    (value || "(vazio)")
  );
}

function looksAutoGeneratedDescription(description: string): boolean {
  return (
    description.includes(" → ") || /^[A-Z][A-Za-z0-9 ]+$/.test(description)
  );
}

function humanizeIdentifier(value: string): string {
  const label = value
    .split(/[_\s.-]+/)
    .filter(Boolean)
    .map((token) => TOKEN_LABELS[token.toLowerCase()] ?? token)
    .join(" ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}
