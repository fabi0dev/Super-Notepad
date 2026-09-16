import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  APP_ACCENT,
  APP_ACCENT_GLOW_DARK,
  APP_ACCENT_GLOW_LIGHT,
  APP_ACCENT_FG_DARK,
  APP_ACCENT_FILL_DARK,
  APP_ACCENT_FILL_LIGHT,
  APP_ACCENT_FG_LIGHT,
  APP_ACCENT_LIGHT,
  APP_PRIMARY_MUTED_BG,
  APP_PRIMARY_MUTED_BG_LIGHT,
  APP_SECONDARY_ACCENT,
  APP_SECONDARY_ACCENT_LIGHT,
  APP_SELECTION_BG,
  APP_SELECTION_BG_LIGHT,
  APP_SIDEBAR_ACTIVE_BG,
  APP_SIDEBAR_BORDER_DARK,
  APP_SIDEBAR_BORDER_LIGHT,
  APP_SIDEBAR_FG_MUTED_DARK,
  APP_SIDEBAR_FG_MUTED_LIGHT,
  APP_SIDEBAR_HOVER_BG,
  APP_SIDEBAR_HOVER_BG_LIGHT,
  APP_SIDEBAR_ICON_FG_DARK,
  APP_SIDEBAR_LABEL_DARK,
  APP_SIDEBAR_LABEL_LIGHT,
  APP_CHIP_DESTRUCTIVE_BG_LIGHT,
  APP_CHIP_DESTRUCTIVE_FG_LIGHT,
  APP_CHIP_PRIMARY_BG_LIGHT,
  APP_CHIP_PRIMARY_FG_LIGHT,
  APP_CHIP_SUCCESS_BG_LIGHT,
  APP_CHIP_SUCCESS_FG_LIGHT,
  APP_CHIP_WARNING_BG_LIGHT,
  APP_CHIP_WARNING_FG_LIGHT,
  APP_SUCCESS_BORDER_LIGHT,
  APP_SUCCESS_DARK,
  APP_THEME_ACCENT_SURFACE_DARK,
  APP_THEME_ACCENT_SURFACE_LIGHT,
  APP_THEME_SECONDARY_SURFACE_DARK,
  APP_THEME_SECONDARY_SURFACE_LIGHT,
  APP_WEB_BG,
  APP_WEB_FG,
  APP_WEB_BORDER,
  APP_WEB_BORDER_STRONG,
  APP_WEB_BORDER_LIGHT,
  APP_WEB_CARD,
  APP_WEB_CODE_BG,
  APP_WEB_ACTION_CARD_BG,
  APP_WEB_COMPOSER_BG,
  APP_WEB_FOOTER_MUTED_DARK,
  APP_WEB_FOOTER_MUTED_LIGHT,
  APP_WEB_MUTED,
  APP_WEB_MUTED_LIGHT,
  APP_WEB_BORDER_SUBTLE_LIGHT,
  APP_CONFIG_NAV_BG_LIGHT,
  APP_FIELD_BG_LIGHT,
  APP_STATUS_PILL_BG_LIGHT,
  APP_STATUS_PILL_FG_LIGHT,
  APP_WEB_CODE_BG_LIGHT,
  APP_WEB_SURFACE,
  APP_WEB_SURFACE_HOVER,
  APP_WEB_SURFACE_HOVER_LIGHT,
  APP_WEB_SURFACE_LIGHT,
} from "@sn/theme-tokens";
import { APP_LOGO_FILL } from "./logoTokens";
import {
  isDesktopApp,
  persistTransparentPref,
  fetchTransparentPref,
  persistDesktopTheme,
} from "@/lib/desktopNotifications";
import { darkTheme, lightTheme } from "./presets";
import type {
  DashboardTheme,
  ThemeLayer,
  ThemeLayout,
  ThemePalette,
  ThemeTypography,
} from "./types";

const STORAGE_KEY = "super-notepad-theme";
const TRANSPARENT_BG_KEY = "sn-dashboard-transparent-bg";
const TRANSPARENT_BG_OPACITY_KEY = "sn-dashboard-transparent-bg-opacity";
// Reversão de tema agendada ("muda agora e volte depois"). Guardada com um
// instante ABSOLUTO para sobreviver a reload/reabrir janela: no mount o provider
// reconcilia (se já passou, aplica na hora; senão reagenda o tempo restante).
const THEME_REVERT_KEY = "super-notepad-theme-revert";

type ThemeName = "dark" | "light" | "system";

function isThemeName(v: unknown): v is ThemeName {
  return v === "dark" || v === "light" || v === "system";
}

interface ThemeRevert {
  to: ThemeName;
  at: number;
}

function readThemeRevert(): ThemeRevert | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(THEME_REVERT_KEY);
    if (!raw) return null;
    const rec = JSON.parse(raw) as ThemeRevert;
    if (rec && typeof rec.at === "number" && isThemeName(rec.to)) return rec;
  } catch {
    /* localStorage indisponível / JSON corrompido — trata como sem reversão */
  }
  return null;
}

function writeThemeRevert(rec: ThemeRevert) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(THEME_REVERT_KEY, JSON.stringify(rec));
  } catch {
    /* ignora — a reversão só não sobrevive a reload */
  }
}

function clearThemeRevert() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(THEME_REVERT_KEY);
  } catch {
    /* ignora */
  }
}

const INJECTED_FONT_URLS = new Set<string>();

function layerVars(
  name: "background" | "midground" | "foreground",
  layer: ThemeLayer,
): Record<string, string> {
  const pct = Math.round(layer.alpha * 100);
  return {
    [`--${name}`]:
      layer.alpha === 1
        ? layer.hex
        : `color-mix(in srgb, ${layer.hex} ${pct}%, transparent)`,
    [`--${name}-base`]: layer.hex,
    [`--${name}-alpha`]: String(layer.alpha),
  };
}

function paletteVars(palette: ThemePalette): Record<string, string> {
  return {
    ...layerVars("background", palette.background),
    ...layerVars("midground", palette.midground),
    ...layerVars("foreground", palette.foreground),
    "--warm-glow": palette.warmGlow,
    "--noise-opacity-mul": String(palette.noiseOpacity),
  };
}

const DENSITY_MULTIPLIERS: Record<string, string> = {
  compact: "0.85",
  comfortable: "1",
  spacious: "1.2",
};

function typographyVars(typo: ThemeTypography): Record<string, string> {
  return {
    "--theme-font-sans": typo.fontSans,
    "--theme-font-mono": typo.fontMono,
    "--theme-font-display": typo.fontDisplay ?? typo.fontSans,
    "--theme-base-size": typo.baseSize,
    "--theme-line-height": typo.lineHeight,
    "--theme-letter-spacing": typo.letterSpacing,
  };
}

function layoutVars(layout: ThemeLayout): Record<string, string> {
  return {
    "--radius": layout.radius,
    "--theme-radius": layout.radius,
    "--theme-gap": layout.gap,
    "--theme-spacing-mul": DENSITY_MULTIPLIERS[layout.density] ?? "1",
    "--theme-density": layout.density,
  };
}

function injectFontStylesheet(url: string | undefined) {
  if (!url || typeof document === "undefined") return;
  if (INJECTED_FONT_URLS.has(url)) return;
  const existing = document.querySelector<HTMLLinkElement>(
    `link[rel="stylesheet"][href="${CSS.escape(url)}"]`,
  );
  if (existing) {
    INJECTED_FONT_URLS.add(url);
    return;
  }
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = url;
  link.setAttribute("data-sn-theme-font", "true");
  document.head.appendChild(link);
  INJECTED_FONT_URLS.add(url);
}

/**
 * Quanto do fundo do tema ainda é pintado quando a janela é translúcida.
 *
 * Quanto menor, mais atravessa. O usuário ajusta isto em Configurações, e a
 * faixa é limitada de propósito: perto de 0 o texto fica ilegível sobre um
 * papel de parede claro, e em 1 não sobra transparência nenhuma — nos dois
 * extremos a opção deixaria de fazer o que promete.
 */
export const TRANSPARENT_BG_ALPHA_PADRAO = 0.5;
export const TRANSPARENT_BG_ALPHA_MIN = 0.2;
export const TRANSPARENT_BG_ALPHA_MAX = 0.9;

/**
 * Superfícies elevadas (composer, cards, bolha do usuário, blocos de código)
 * também cedem, mas sempre MENOS que o fundo.
 *
 * Deixá-las opacas produzia lajes sólidas flutuando sobre uma janela
 * translúcida — o pior dos dois mundos. Ceder junto com o fundo, na mesma
 * medida, apagaria a diferença de luminosidade que separa uma da outra.
 * Manter a distância entre as duas é o que preserva a leitura das camadas.
 */
const DISTANCIA_SUPERFICIE = 0.25;
const ALPHA_SUPERFICIE_MAX = 0.96;

/**
 * Tokens que pintam superfície grande e devem acompanhar a transparência.
 *
 * A lista é explícita porque a regra é semântica, não de valor: `--surface`
 * e `--badge-neutral-bg` têm a MESMA cor, e só um deles é superfície de
 * leitura. Emblema, acento e borda ficam de fora — translúcidos, viram
 * borrão sobre o papel de parede.
 *
 * `--surface`, `--surface-hover`, `--glass-bg` e `--card-bg` também ficaram
 * de fora, e por um motivo mais duro: cada um serve ao mesmo tempo a
 * superfície plana e a painel FLUTUANTE (menu, dropdown, balão). O que
 * flutua cobre conteúdo, e translúcido deixa o texto de baixo atravessar —
 * foi assim que os menus viraram um borrão ilegível. São 71 usos só de
 * `--surface`: converter um a um arriscaria deixar algum menu para trás, e
 * o custo de errar é justamente a leitura.
 */
const SUPERFICIES_QUE_CEDEM = [
  "--surface-elevated",
  "--field-bg",
  "--config-nav-bg",
  "--chat-composer-shell-bg",
  "--chat-composer-inner-bg",
  "--chat-user-bubble-bg",
  "--chat-code-bg",
  "--chat-tool-card-bg",
  "--chat-action-card-bg",
  "--chat-table-header-bg",
] as const;

/** `#RRGGBB` → mistura com transparente. Outros formatos passam intactos. */
function tingir(cor: string, alpha: number): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(cor.trim())) return cor;
  return `color-mix(in srgb, ${cor.trim()} ${Math.round(alpha * 100)}%, transparent)`;
}

function limitarAlpha(valor: number): number {
  if (!Number.isFinite(valor)) return TRANSPARENT_BG_ALPHA_PADRAO;
  return Math.min(
    TRANSPARENT_BG_ALPHA_MAX,
    Math.max(TRANSPARENT_BG_ALPHA_MIN, valor),
  );
}

function applyTheme(
  theme: DashboardTheme,
  transparent = false,
  alphaDoFundo = TRANSPARENT_BG_ALPHA_PADRAO,
) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  // Modo transparente REMOVIDO: no WKWebView (janela transparente + vibrancy) o
  // conteúdo que rola deixava rastro e as superfícies empilhavam tons diferentes
  // (faixas), sem um resultado consistente. O app é sempre OPACO. A engrenagem
  // fica no código (fácil de reativar), mas desligada aqui e sem toggle na UI.
  transparent = false;
  // O fundo translúcido entra pela mesma engrenagem que já existia: `layerVars`
  // emite `color-mix(...)` sempre que a camada tem alfa < 1. Não é o `html` que
  // recebe a tinta — é a variável, e com ela todas as superfícies de fundo do
  // shell (que são várias, empilhadas) ficam translúcidas de uma vez. Pintar só
  // o elemento raiz não bastava: o shell opaco por cima tapava o desfoque.
  const palette = transparent
    ? {
        ...theme.palette,
        background: { ...theme.palette.background, alpha: limitarAlpha(alphaDoFundo) },
      }
    : theme.palette;
  const vars = {
    ...paletteVars(palette),
    ...typographyVars(theme.typography),
    ...layoutVars(theme.layout),
  };

  // Derived semantic vars — computed from the palette so all components
  // can use a single set of surface/border/hover/focus tokens regardless
  // of whether the theme is dark or light.
  const isDark =
    !theme.palette.background.hex.startsWith("#F") &&
    parseInt(theme.palette.background.hex.slice(1, 3), 16) < 128;

  if (isDark) {
    vars["--primary-accent"] = APP_ACCENT;
    // `--primary-fill` != `--primary-accent`: o verde escuro (`#0B6350`)
    // é ótimo como fundo de texto branco e péssimo como texto sobre o
    // canvas quase preto (2.6:1). Sólidos usam o fill, texto usa o acento.
    vars["--primary-fill"] = APP_ACCENT_FILL_DARK;
    vars["--primary-foreground"] = APP_ACCENT_FG_DARK;
    vars["--primary-accent-glow"] = APP_ACCENT_GLOW_DARK;
    vars["--secondary-accent"] = APP_SECONDARY_ACCENT;
    vars["--selection-surface"] = APP_SELECTION_BG;
    vars["--primary-muted"] = APP_PRIMARY_MUTED_BG;
    vars["--sidebar-active-bg"] = APP_SIDEBAR_ACTIVE_BG;
    vars["--sidebar-hover-bg"] = APP_SIDEBAR_HOVER_BG;
    vars["--sidebar-border-accent"] = APP_SIDEBAR_BORDER_DARK;
    vars["--sidebar-label"] = APP_SIDEBAR_LABEL_DARK;
    vars["--sidebar-fg-muted"] = APP_SIDEBAR_FG_MUTED_DARK;
    vars["--sidebar-icon-fg"] = APP_SIDEBAR_ICON_FG_DARK;
    vars["--surface"] = APP_WEB_SURFACE;
    vars["--surface-hover"] = APP_WEB_SURFACE_HOVER;
    vars["--border-color"] = APP_WEB_BORDER;
    vars["--border"] = APP_WEB_BORDER;
    vars["--border-strong"] = APP_WEB_BORDER_STRONG;
    vars["--field-border"] = "color-mix(in srgb, var(--foreground) 7%, transparent)";
    vars["--field-border-focus"] =
      "color-mix(in srgb, var(--primary-accent) 38%, transparent)";
    vars["--field-bg"] = APP_WEB_SURFACE;
    vars["--divider"] = APP_WEB_BORDER;
    vars["--overlay"] = APP_WEB_BG;
    vars["--card-bg"] = APP_WEB_CARD;
    vars["--glass-bg"] = APP_WEB_SURFACE;
    vars["--glass-border"] = APP_WEB_BORDER;
    vars["--surface-elevated"] = APP_WEB_COMPOSER_BG;
    vars["--muted-foreground"] = APP_WEB_MUTED;
    vars["--success"] = APP_SUCCESS_DARK;
    vars["--success-bg"] = "rgba(16, 185, 129, 0.14)";
    vars["--success-border"] = "rgba(16, 185, 129, 0.28)";
    vars["--badge-primary-bg"] = APP_PRIMARY_MUTED_BG;
    vars["--badge-primary-fg"] = APP_ACCENT;
    vars["--badge-success-bg"] = "rgba(16, 185, 129, 0.14)";
    vars["--badge-success-fg"] = APP_SUCCESS_DARK;
    vars["--badge-destructive-bg"] = "rgba(239, 68, 68, 0.12)";
    vars["--badge-destructive-fg"] = "#F87171";
    vars["--badge-warning-bg"] = "rgba(245, 158, 11, 0.14)";
    vars["--badge-warning-fg"] = "#FBBF24";
    vars["--badge-neutral-bg"] = APP_WEB_SURFACE;
    vars["--badge-neutral-fg"] = APP_WEB_MUTED;
    vars["--chat-tool-border"] = APP_WEB_BORDER;
    vars["--chat-tool-card-bg"] = APP_WEB_SURFACE;
    vars["--chat-table-header-bg"] = APP_WEB_SURFACE;
    vars["--chat-tool-rail-icon-fg"] = APP_SIDEBAR_ICON_FG_DARK;
    vars["--config-nav-bg"] = APP_WEB_SURFACE;
    vars["--chat-canvas-bg"] = APP_WEB_BG;
    vars["--chat-sidebar-bg"] = APP_WEB_BG;
    vars["--chat-user-bubble-bg"] = APP_WEB_COMPOSER_BG;
    vars["--chat-code-bg"] = APP_WEB_CODE_BG;
    vars["--chat-composer-shell-bg"] = APP_WEB_COMPOSER_BG;
    vars["--chat-composer-inner-bg"] = APP_WEB_COMPOSER_BG;
    vars["--chat-composer-border"] =
      "color-mix(in srgb, var(--border-color) 42%, transparent)";
    vars["--chat-action-card-bg"] = APP_WEB_ACTION_CARD_BG;
    // Chips do composer (pasta/branch): sobem UM degrau de luminosidade acima
    // do fundo do composer para lerem como controle, sem borda nem sombra.
    vars["--chat-chip-bg"] = APP_WEB_CARD;
    vars["--chat-chip-hover"] = APP_WEB_SURFACE_HOVER;
    vars["--chat-footer-muted"] = APP_WEB_FOOTER_MUTED_DARK;
    vars["--chat-section-border"] = "rgba(255, 255, 255, 0.12)";
    vars["--chat-message-fg"] = APP_WEB_FG;
    vars["--theme-secondary-surface"] = APP_THEME_SECONDARY_SURFACE_DARK;
    vars["--theme-accent-surface"] = APP_THEME_ACCENT_SURFACE_DARK;
    vars["--sn-logo-fill"] = APP_LOGO_FILL.dark;
    root.dataset.theme = "dark";
  } else {
    vars["--primary-accent"] = APP_ACCENT_LIGHT;
    vars["--primary-fill"] = APP_ACCENT_FILL_LIGHT;
    vars["--primary-foreground"] = APP_ACCENT_FG_LIGHT;
    vars["--primary-accent-glow"] = APP_ACCENT_GLOW_LIGHT;
    vars["--secondary-accent"] = APP_SECONDARY_ACCENT_LIGHT;
    vars["--selection-surface"] = APP_SELECTION_BG_LIGHT;
    vars["--primary-muted"] = APP_PRIMARY_MUTED_BG_LIGHT;
    vars["--sidebar-active-bg"] = APP_ACCENT_LIGHT;
    vars["--sidebar-hover-bg"] = APP_SIDEBAR_HOVER_BG_LIGHT;
    vars["--sidebar-border-accent"] = APP_SIDEBAR_BORDER_LIGHT;
    vars["--sidebar-label"] = APP_SIDEBAR_LABEL_LIGHT;
    vars["--sidebar-fg-muted"] = APP_SIDEBAR_FG_MUTED_LIGHT;
    vars["--sidebar-icon-fg"] = "#000000";
    vars["--glass-bg"] = APP_WEB_SURFACE_LIGHT;
    vars["--glass-border"] = APP_WEB_BORDER_SUBTLE_LIGHT;
    vars["--surface-elevated"] = APP_WEB_SURFACE_LIGHT;
    // Canvas é branco (ver presets.ts); os cards/superfícies usam o
    // quase-branco `#F6F8FA` (`--surface`) para separar por luminosidade.
    vars["--surface"] = APP_WEB_SURFACE_LIGHT;
    vars["--surface-hover"] = APP_WEB_SURFACE_HOVER_LIGHT;
    vars["--border-color"] = APP_WEB_BORDER_SUBTLE_LIGHT;
    vars["--border"] = APP_WEB_BORDER_SUBTLE_LIGHT;
    vars["--border-strong"] = APP_WEB_BORDER_LIGHT;
    vars["--field-border"] = APP_WEB_BORDER_SUBTLE_LIGHT;
    vars["--field-border-focus"] =
      "color-mix(in srgb, var(--primary-accent) 42%, transparent)";
    vars["--field-bg"] = APP_FIELD_BG_LIGHT;
    vars["--divider"] = APP_WEB_BORDER_SUBTLE_LIGHT;
    vars["--overlay"] = "#94A3B8";
    vars["--card-bg"] = APP_WEB_SURFACE_LIGHT;
    vars["--muted-foreground"] = APP_WEB_MUTED_LIGHT;
    vars["--success"] = APP_CHIP_SUCCESS_FG_LIGHT;
    vars["--success-bg"] = APP_CHIP_SUCCESS_BG_LIGHT;
    vars["--success-border"] = APP_SUCCESS_BORDER_LIGHT;
    vars["--badge-primary-bg"] = APP_CHIP_PRIMARY_BG_LIGHT;
    vars["--badge-primary-fg"] = APP_CHIP_PRIMARY_FG_LIGHT;
    vars["--badge-success-bg"] = APP_CHIP_SUCCESS_BG_LIGHT;
    vars["--badge-success-fg"] = APP_CHIP_SUCCESS_FG_LIGHT;
    vars["--badge-destructive-bg"] = APP_CHIP_DESTRUCTIVE_BG_LIGHT;
    vars["--badge-destructive-fg"] = APP_CHIP_DESTRUCTIVE_FG_LIGHT;
    vars["--badge-warning-bg"] = APP_CHIP_WARNING_BG_LIGHT;
    vars["--badge-warning-fg"] = APP_CHIP_WARNING_FG_LIGHT;
    vars["--badge-neutral-bg"] = APP_STATUS_PILL_BG_LIGHT;
    vars["--badge-neutral-fg"] = APP_STATUS_PILL_FG_LIGHT;
    vars["--chat-canvas-bg"] = "#FFFFFF";
    vars["--chat-sidebar-bg"] = "#FFFFFF";
    vars["--chat-user-bubble-bg"] = APP_WEB_SURFACE_LIGHT;
    vars["--chat-code-bg"] = APP_WEB_CODE_BG_LIGHT;
    vars["--chat-composer-shell-bg"] = "#FFFFFF";
    vars["--chat-composer-inner-bg"] = APP_WEB_SURFACE_LIGHT;
    vars["--chat-composer-border"] =
      "color-mix(in srgb, var(--border-color) 42%, transparent)";
    vars["--chat-action-card-bg"] = APP_WEB_SURFACE_LIGHT;
    // Composer é #F6F8FA (`--surface`); o chip precisa de uma cor DISTINTA ou
    // some. No claro descemos um degrau (mais escuro) — luminosidade, não borda.
    // Controles do chat (chips, seletores do composer, abas Início/Code) num
    // cinza-frio LEVE — o hover (#E4E9EF) pesava demais como estado de repouso
    // sobre o branco. Token único: `--chat-chip-bg`.
    vars["--chat-chip-bg"] = "#EDF0F4";
    vars["--chat-chip-hover"] = APP_WEB_BORDER_LIGHT;
    vars["--chat-footer-muted"] = APP_WEB_FOOTER_MUTED_LIGHT;
    vars["--chat-section-border"] = "rgba(0, 0, 0, 0.22)";
    vars["--chat-message-fg"] = "#000000";
    vars["--chat-tool-border"] = APP_WEB_BORDER_SUBTLE_LIGHT;
    vars["--chat-tool-card-bg"] = APP_WEB_SURFACE_LIGHT;
    vars["--chat-table-header-bg"] = APP_WEB_SURFACE_HOVER_LIGHT;
    vars["--chat-tool-rail-icon-fg"] = "#64748B";
    vars["--config-nav-bg"] = APP_CONFIG_NAV_BG_LIGHT;
    vars["--theme-secondary-surface"] = APP_THEME_SECONDARY_SURFACE_LIGHT;
    vars["--theme-accent-surface"] = APP_THEME_ACCENT_SURFACE_LIGHT;
    vars["--sn-logo-fill"] = APP_LOGO_FILL.light;
    root.dataset.theme = "light";
  }

  // Tailwind `dark:` variant uses the `.dark` class by default. Keep it in sync
  // with `data-theme` so components using either mechanism behave consistently.
  root.classList.toggle("dark", isDark);

  // O que FLUTUA por cima do conteúdo (menu, dropdown, popover) precisa
  // continuar opaco: ali a translucidez deixa o texto de baixo atravessar e
  // a leitura se perde. `--card-bg` servia aos dois papéis ao mesmo tempo —
  // card no fluxo e painel flutuante — e cedendo junto levou os menus para
  // um estado ilegível. Este token existe só para separar os dois.
  vars["--popover-bg"] = vars["--card-bg"];

  if (transparent) {
    // Várias superfícies repintam a MESMA cor do fundo da página com nome
    // próprio (`--chat-canvas-bg`, `--chat-sidebar-bg`, `--overlay`). Cada
    // uma delas, deixada opaca, tapa sozinha o fundo translúcido de baixo —
    // foi o que aconteceu com a barra lateral depois que o canvas já estava
    // resolvido.
    //
    // A regra é por VALOR, não por nome: o que pinta exatamente a cor de
    // fundo é fundo, e cede lugar. O que tem cor própria é superfície
    // elevada (composer, cards, campos) e continua opaco — é a diferença de
    // luminosidade entre elas que separa as camadas na interface.
    // `--overlay` casa a cor por coincidência e NÃO é fundo: é o véu que
    // escurece a tela atrás dos modais (`color-mix(…, var(--overlay) 80%,
    // …)`). Zerado, os diálogos perdem o escurecimento e passam a flutuar
    // sobre a conversa sem nenhuma separação.
    const alphaSuperficie = Math.min(
      ALPHA_SUPERFICIE_MAX,
      limitarAlpha(alphaDoFundo) + DISTANCIA_SUPERFICIE,
    );
    for (const chave of SUPERFICIES_QUE_CEDEM) {
      const atual = vars[chave];
      if (typeof atual === "string") vars[chave] = tingir(atual, alphaSuperficie);
    }

    // A heurística "casa a cor do fundo -> cede" quebra no tema claro, onde o
    // card é branco puro igual ao fundo (#FFFFFF). Sem esta guarda, o painel do
    // modal, o popover e as superfícies elevadas virariam `transparent` e a
    // conversa atravessaria o diálogo. Elas FLUTUAM sobre o conteúdo: mesmo
    // pintando a cor do fundo por coincidência, precisam continuar opacas. No
    // tema escuro esses tokens já diferem do fundo, então a guarda é inócua.
    const naoSaoFundo = new Set([
      "--background",
      "--background-base",
      "--overlay",
      "--card-bg",
      "--popover-bg",
      "--surface",
      "--surface-elevated",
      "--glass-bg",
    ]);
    const corDeFundo = theme.palette.background.hex.toLowerCase();
    for (const [chave, valor] of Object.entries(vars)) {
      if (naoSaoFundo.has(chave)) continue;
      if (typeof valor === "string" && valor.toLowerCase() === corDeFundo) {
        vars[chave] = "transparent";
      }
    }
  }

  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  injectFontStylesheet(theme.typography.fontUrl);
}

function getSystemTheme(): "dark" | "light" {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeName, setThemeName] = useState<string>(() => {
    if (typeof window === "undefined") return "dark";
    return window.localStorage.getItem(STORAGE_KEY) ?? "dark";
  });

  const [osPref, setOsPref] = useState<"dark" | "light">(() =>
    getSystemTheme(),
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const handler = (e: MediaQueryListEvent) =>
      setOsPref(e.matches ? "light" : "dark");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Fundo transparente: preferência de aparência, guardada junto do tema.
  // Só produz efeito no app desktop, cuja janela é criada transparente com
  // desfoque atrás; num navegador não há janela cujo fundo se possa vazar, e
  // o seletor no painel de Configurações nem aparece.
  const [transparentBackground, setTransparentBackgroundState] =
    useState<boolean>(() => {
      if (typeof window === "undefined") return false;
      return window.localStorage.getItem(TRANSPARENT_BG_KEY) === "true";
    });

  const [backgroundOpacity, setBackgroundOpacityState] = useState<number>(() => {
    if (typeof window === "undefined") return TRANSPARENT_BG_ALPHA_PADRAO;
    const guardado = window.localStorage.getItem(TRANSPARENT_BG_OPACITY_KEY);
    return guardado === null
      ? TRANSPARENT_BG_ALPHA_PADRAO
      : limitarAlpha(Number(guardado));
  });

  // True quando a preferência de transparência mudou mas a janela atual nasceu
  // com a outra — só o app desktop sinaliza, e só até reiniciar.
  const [transparentRestartNeeded, setTransparentRestartNeeded] =
    useState<boolean>(false);
  // Estado da transparência no arranque = com o que a janela nativa nasceu (o
  // servidor mantém o arquivo em sincronia com o localStorage). Trocar para algo
  // diferente disto exige recriar a janela, ou seja, reiniciar o app.
  const transparenteNoArranque = useRef(transparentBackground);

  const resolved =
    themeName === "system" ? osPref : (themeName as "dark" | "light");
  const theme = resolved === "light" ? lightTheme : darkTheme;

  useLayoutEffect(() => {
    // Modo transparente REMOVIDO — app sempre opaco (ver applyTheme). Ignora a
    // pref e nunca marca `data-transparent`, mesmo que o valor antigo persista
    // no localStorage de quem já tinha ligado.
    applyTheme(theme, false, backgroundOpacity);
    delete document.documentElement.dataset.transparent;
  }, [theme, backgroundOpacity]);

  // Espelha o tema ESCOLHIDO (dark/light/system) para o splash do bootstrap do
  // desktop — arquivo lido pelo Tauri no arranque. Roda no mount e a cada
  // troca, então o splash acerta a cor já no próximo início, mesmo sem uma
  // troca explícita. No navegador é no-op.
  useEffect(() => {
    void persistDesktopTheme(themeName);
  }, [themeName]);

  // Casa o CSS com o estado REAL da janela nativa. A janela nasce transparente
  // (ou não) conforme o arquivo que o Tauri lê; esse arquivo é a fonte da
  // verdade. Uma janela recém-aberta (a de e-mail) pode não ter o localStorage
  // sincronizado, então buscamos a preferência no servidor e a adotamos como o
  // "estado de arranque" desta janela — sem pedir reinício, já que é justamente
  // com o que a janela nasceu. Só no app desktop; no navegador é no-op.
  useEffect(() => {
    let cancelado = false;
    void fetchTransparentPref().then((servidor) => {
      if (cancelado || servidor === null) return;
      transparenteNoArranque.current = servidor;
      if (servidor !== transparentBackground) {
        setTransparentBackgroundState(servidor);
        if (typeof window !== "undefined")
          window.localStorage.setItem(TRANSPARENT_BG_KEY, String(servidor));
      }
    });
    return () => {
      cancelado = true;
    };
    // Intencional: roda só na montagem — reconciliação inicial com o servidor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setBackgroundOpacity = useCallback((valor: number) => {
    const limitado = limitarAlpha(valor);
    setBackgroundOpacityState(limitado);
    if (typeof window !== "undefined")
      window.localStorage.setItem(TRANSPARENT_BG_OPACITY_KEY, String(limitado));
  }, []);

  const setTransparentBackground = useCallback((enabled: boolean) => {
    setTransparentBackgroundState(enabled);
    if (typeof window !== "undefined")
      window.localStorage.setItem(TRANSPARENT_BG_KEY, String(enabled));
    // No app desktop a transparência da janela só vale na criação: persiste a
    // preferência (para o próximo arranque) e avisa se é preciso reiniciar.
    void persistTransparentPref(enabled);
    setTransparentRestartNeeded(
      isDesktopApp() && enabled !== transparenteNoArranque.current,
    );
  }, []);

  // Timer da reversão agendada (um por janela). Um só de cada vez.
  const revertTimerRef = useRef<number | null>(null);
  const cancelRevertTimer = useCallback(() => {
    if (revertTimerRef.current !== null && typeof window !== "undefined") {
      window.clearTimeout(revertTimerRef.current);
    }
    revertTimerRef.current = null;
  }, []);

  const setTheme = useCallback(
    (name: string) => {
      const valid = isThemeName(name) ? name : "dark";
      setThemeName(valid);
      if (typeof window !== "undefined")
        window.localStorage.setItem(STORAGE_KEY, valid);
      // Uma escolha DEFINITIVA de tema (usuário, agente, ou a própria reversão ao
      // disparar) cancela qualquer reversão pendente — senão uma volta antiga
      // brigaria com a escolha nova. Quem AGENDA (scheduleThemeRevert) grava o
      // registro DEPOIS de chamar setTheme, então a ordem preserva o novo.
      cancelRevertTimer();
      clearThemeRevert();
      // A persistência para o splash do desktop é feita pelo efeito de `themeName`
      // (cobre mount e troca) — não precisa duplicar aqui.
    },
    [cancelRevertTimer],
  );

  // Arma o timer que reverte o tema quando o prazo chega (aplica + limpa via
  // setTheme). `delayMs<=0` reverte já.
  const armRevertTimer = useCallback(
    (to: ThemeName, delayMs: number) => {
      cancelRevertTimer();
      if (typeof window === "undefined") return;
      revertTimerRef.current = window.setTimeout(
        () => {
          revertTimerRef.current = null;
          setTheme(to);
        },
        Math.max(0, delayMs),
      );
    },
    [cancelRevertTimer, setTheme],
  );

  // "Muda agora e volte depois": aplica-se ANTES de agendar (via setTheme, que
  // limpa reversão anterior); aqui só grava o registro absoluto e arma o timer.
  const scheduleThemeRevert = useCallback(
    (to: string, afterMinutes: number) => {
      if (!isThemeName(to) || !(afterMinutes > 0)) return;
      const at = Date.now() + afterMinutes * 60_000;
      writeThemeRevert({ to, at });
      armRevertTimer(to, at - Date.now());
    },
    [armRevertTimer],
  );

  // Reconcilia uma reversão pendente no arranque (reload / reabrir janela): se o
  // prazo já passou, aplica na hora; senão reagenda o tempo restante. Roda só na
  // montagem.
  useEffect(() => {
    const rec = readThemeRevert();
    if (rec) {
      const remaining = rec.at - Date.now();
      if (remaining <= 0) setTheme(rec.to);
      else armRevertTimer(rec.to, remaining);
    }
    return () => cancelRevertTimer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const availableThemes = useMemo(
    () => [
      { name: "dark" as const, label: "Escuro", description: "Tema escuro" },
      { name: "light" as const, label: "Claro", description: "Tema claro" },
      {
        name: "system" as const,
        label: "Sistema",
        description: "Segue o sistema",
      },
    ],
    [],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      themeName,
      availableThemes,
      setTheme,
      scheduleThemeRevert,
      transparentBackground,
      setTransparentBackground,
      transparentRestartNeeded,
      backgroundOpacity,
      setBackgroundOpacity,
    }),
    [
      theme,
      themeName,
      availableThemes,
      setTheme,
      scheduleThemeRevert,
      transparentBackground,
      setTransparentBackground,
      transparentRestartNeeded,
      backgroundOpacity,
      setBackgroundOpacity,
    ],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: darkTheme,
  themeName: "dark",
  availableThemes: [],
  setTheme: () => {},
  scheduleThemeRevert: () => {},
  transparentBackground: false,
  setTransparentBackground: () => {},
  transparentRestartNeeded: false,
  backgroundOpacity: TRANSPARENT_BG_ALPHA_PADRAO,
  setBackgroundOpacity: () => {},
});

interface ThemeContextValue {
  availableThemes: Array<{ description: string; label: string; name: string }>;
  setTheme: (name: string) => void;
  /** Agenda "voltar para outro tema" daqui a N minutos (client-side, robusto a reload). */
  scheduleThemeRevert: (to: string, afterMinutes: number) => void;
  backgroundOpacity: number;
  setBackgroundOpacity: (valor: number) => void;
  setTransparentBackground: (enabled: boolean) => void;
  theme: DashboardTheme;
  themeName: string;
  transparentBackground: boolean;
  /** App desktop: true quando ligar/desligar a transparência pede reiniciar. */
  transparentRestartNeeded: boolean;
}
