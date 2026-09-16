import { APP_WARM_GLOW_DARK, APP_WARM_GLOW_LIGHT } from "@sn/theme-tokens";
import type { DashboardTheme, ThemeTypography, ThemeLayout } from "./types";

// Stack de sistema. 'Geist' vinha primeiro na lista mas NUNCA existiu no
// projeto — sem arquivo em public/fonts e sem `fontUrl` — então tudo caía
// no fallback de qualquer jeito. Nomear o que de fato renderiza evita a
// ilusão de que a tipografia está definida quando não está: aqui é SF Pro
// no macOS, Segoe UI no Windows, Inter/Roboto no Linux.
const SYSTEM_SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", Inter, Roboto, "Helvetica Neue", Arial, sans-serif';
const SYSTEM_MONO = 'ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace';

const TYPOGRAPHY: ThemeTypography = {
  fontSans: SYSTEM_SANS,
  fontMono: SYSTEM_MONO,
  baseSize: "16px",
  lineHeight: "1.6",
  letterSpacing: "0",
};

const LAYOUT: ThemeLayout = {
  radius: "0.5rem",
  gap: "1rem",
  density: "comfortable",
};

export const darkTheme: DashboardTheme = {
  name: "dark",
  label: "Escuro",
  description: "Preto piano com acento azul",
  palette: {
    background: { hex: "#131316", alpha: 1 },
    midground: { hex: "#A3A3AC", alpha: 1 },
    foreground: { hex: "#DEDEE2", alpha: 1 },
    warmGlow: APP_WARM_GLOW_DARK,
    noiseOpacity: 0.12,
  },
  typography: TYPOGRAPHY,
  layout: LAYOUT,
};

export const lightTheme: DashboardTheme = {
  name: "light",
  label: "Claro",
  description: "Base clara com acento ciano",
  palette: {
    // Canvas branco: identidade única e clara em todas as telas. Os cards
    // (`cardClass`) já têm borda sutil (`--border-color`), então continuam
    // definidos no branco — sem precisar do canvas cinza pra separar.
    background: { hex: "#FFFFFF", alpha: 1 },
    midground: { hex: "#3F3F46", alpha: 1 },
    foreground: { hex: "#1A1A1A", alpha: 1 },
    warmGlow: APP_WARM_GLOW_LIGHT,
    noiseOpacity: 0.04,
  },
  typography: TYPOGRAPHY,
  layout: LAYOUT,
};

export const BUILTIN_THEMES: Record<string, DashboardTheme> = {
  dark: darkTheme,
  light: lightTheme,
};
