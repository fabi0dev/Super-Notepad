/** Decode common HTML entities once — safe before re-escaping for display. */
export function decodeHtmlEntities(text: string): string {
  if (!text || !text.includes("&")) return text;

  // DOM innerHTML mangles raw angle brackets (ex.: git --author="Name <email@host>").
  if (typeof document !== "undefined" && !/[<>]/.test(text)) {
    const el = document.createElement("textarea");
    el.innerHTML = text;
    const decoded = el.value;
    if (decoded !== text) return decoded;
  }

  return text
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(parseInt(code, 16)),
    )
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&#34;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&#x22;", '"')
    .replaceAll("&nbsp;", "\u00a0");
}
