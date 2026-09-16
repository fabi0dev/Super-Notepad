import { api } from "@/lib/api";

/**
 * Abre uma rota do painel numa janela desktop própria, já autenticada.
 *
 * A janela nasce sem o cookie de sessão do pai (app desktop), então pedimos um
 * token curto e abrimos `?token=` — o gate o troca por um cookie próprio.
 *
 * `panel=1` (o padrão, quando `withSidebar` é falso) faz a janela abrir enxuta:
 * sem a sidebar do app e sem o corvo do splash. É por isso que abrir um app
 * "pela gaveta" (notificações) precisa passar por AQUI, e não por um
 * `navigate()` — navegar troca a rota DENTRO da janela atual, e a Home então
 * ganharia a sidebar do app (o bug de "sidebar do Super Notepad nas Notas").
 *
 * `path` pode já incluir query (`/notas?open=<id>`); `params` são mesclados por
 * cima.
 */
export async function openAppWindow(
  path: string,
  opts?: { withSidebar?: boolean; params?: Record<string, string> },
): Promise<void> {
  const withSidebar = opts?.withSidebar ?? false;
  const origin = window.location.origin;
  const [rawPath, rawQuery = ""] = path.split("?");
  const qs = new URLSearchParams(rawQuery);
  for (const [k, v] of Object.entries(opts?.params ?? {})) qs.set(k, v);
  // Sem sidebar: janela enxuta (panel). Com sidebar (chat): painel completo.
  if (!withSidebar) qs.set("panel", "1");
  try {
    const { token } = await api.dashboardWindowToken();
    qs.set("token", token);
  } catch {
    // Sem token: abre mesmo assim (a janela mostra o gate se precisar).
  }
  // Cada e-mail na própria janela; o chat compartilha a "sn-chat"; o resto
  // compartilha a "sn-window".
  const uid = qs.get("uid");
  const name = uid
    ? `sn-mail-${uid}`
    : withSidebar
      ? "sn-chat"
      : "sn-window";
  // Sem left/top, o WebView abre a janela onde quiser — às vezes noutro monitor.
  // Centralizamos na JANELA ATUAL (screenX/Y são no espaço virtual multi-monitor),
  // então a nova nasce no MESMO monitor, por cima da atual.
  const w = 1100;
  const h = 820;
  let feats = `popup,width=${w},height=${h}`;
  try {
    const ow = window.outerWidth || window.screen?.availWidth || w;
    const oh = window.outerHeight || window.screen?.availHeight || h;
    const sx = Number.isFinite(window.screenX) ? window.screenX : 0;
    const sy = Number.isFinite(window.screenY) ? window.screenY : 0;
    const left = Math.round(sx + (ow - w) / 2);
    const top = Math.round(sy + (oh - h) / 2);
    feats += `,left=${left},top=${top}`;
  } catch {
    /* posição é best-effort — sem ela, cai no default do WebView */
  }
  const win = window.open(`${origin}${rawPath}?${qs.toString()}`, name, feats);
  if (win) win.opener = null;
}
