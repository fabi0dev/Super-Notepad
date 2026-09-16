// Rótulos de atalho por plataforma. Escrevemos o atalho no estilo macOS
// (⌘ ⌥ ⇧, sem "+"); em Windows/Linux convertemos para Ctrl+Alt+Shift+.
// (Os handlers já aceitam ⌘/Ctrl via metaKey||ctrlKey — isto é só o rótulo.)

const isMac =
  typeof navigator !== "undefined" &&
  /mac|iphone|ipad/i.test(
    // `platform` é depreciado mas confiável para isto; UA como reserva.
    (navigator as Navigator & { userAgentData?: { platform?: string } })
      .userAgentData?.platform ||
      navigator.platform ||
      navigator.userAgent,
  );

/** Converte um atalho escrito no estilo macOS ("⌘⇧S") para o da plataforma
 *  atual — no macOS fica igual; em Windows/Linux vira "Ctrl+Shift+S". */
export function platformShortcut(macStyle: string): string {
  if (isMac) return macStyle;
  return macStyle
    .replace(/⌘/g, "Ctrl+")
    .replace(/⌥/g, "Alt+")
    .replace(/⇧/g, "Shift+");
}
