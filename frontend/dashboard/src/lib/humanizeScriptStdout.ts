import { toHomeRelativePath } from "./composerFooterFormat";

export interface HumanizeScriptStdoutOptions {
  pathHint?: string;
}

const KEY_LABELS: Readonly<Record<string, string>> = {
  existe: "Encontrado",
  exists: "Encontrado",
  encontrado: "Encontrado",
  found: "Encontrado",
  tamanho: "Tamanho",
  size: "Tamanho",
  path: "Caminho",
  caminho: "Caminho",
  file: "Arquivo",
  arquivo: "Arquivo",
  filepath: "Arquivo",
  url: "URL",
  link: "Link",
  status: "Status",
  estado: "Estado",
  error: "Erro",
  erro: "Erro",
  message: "Mensagem",
  mensagem: "Mensagem",
  msg: "Mensagem",
  result: "Resultado",
  resultado: "Resultado",
  count: "Total",
  contagem: "Total",
  total: "Total",
  lines: "Linhas",
  linhas: "Linhas",
  name: "Nome",
  nome: "Nome",
  type: "Tipo",
  tipo: "Tipo",
  version: "Versão",
  versao: "Versão",
  versão: "Versão",
  port: "Porta",
  porta: "Porta",
  host: "Host",
  pid: "PID",
  id: "ID",
  ok: "OK",
  success: "Sucesso",
  sucesso: "Sucesso",
  modified: "Modificado",
  modificado: "Modificado",
  created: "Criado",
  criado: "Criado",
  deleted: "Removido",
  removido: "Removido",
  duration: "Duração",
  duracao: "Duração",
  duração: "Duração",
  cwd: "Diretório",
  working_directory: "Diretório de trabalho",
  diretorio: "Diretório",
  diretório: "Diretório",
  query: "Consulta",
  title: "Título",
  titulo: "Título",
  título: "Título",
  description: "Descrição",
  descricao: "Descrição",
  descrição: "Descrição",
  output: "Saída",
  saida: "Saída",
  saída: "Saída",
  stdout: "Saída",
  stderr: "Erros",
  bytes: "Bytes",
  rows: "Linhas",
  matches: "Correspondências",
  elapsed: "Tempo decorrido",
  elapsed_ms: "Tempo decorrido",
  exit_code: "Código de saída",
  width: "Largura",
  largura: "Largura",
  height: "Altura",
  altura: "Altura",
};

const SKIP_KEYS = new Set(["tool_calls_made"]);

const CURRENCY_KEYS = new Set(["brl", "usd", "eur", "gbp"]);

function formatNumberForKey(key: string, value: number): string {
  const keyLower = key.trim().toLowerCase();
  if (keyLower === "brl") {
    return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }
  if (keyLower === "usd") {
    return value.toLocaleString("pt-BR", { style: "currency", currency: "USD" });
  }
  if (keyLower === "eur") {
    return value.toLocaleString("pt-BR", { style: "currency", currency: "EUR" });
  }
  if (CURRENCY_KEYS.has(keyLower)) {
    return value.toLocaleString("pt-BR");
  }
  return Number.isInteger(value) ? String(value) : value.toLocaleString("pt-BR");
}

function tryParseJsonValue(raw: string): unknown | null {
  const trimmed = raw.trim();
  if (
    !(trimmed.startsWith("{") && trimmed.endsWith("}")) &&
    !(trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    return null;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

function formatHumanValue(value: unknown, depth = 0, parentKey = ""): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return humanizeScalarValue(String(value));
  if (typeof value === "number") return formatNumberForKey(parentKey, value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "[object Object]") return "—";
    const parsed = tryParseJsonValue(trimmed);
    if (parsed !== null) {
      return formatHumanValue(parsed, depth + 1, parentKey);
    }
    return humanizeScalarValue(trimmed);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "—";
    return value
      .map((item, index) => formatHumanValue(item, depth + 1, String(index)))
      .join(", ");
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "—";
    return entries
      .map(([key, nested]) => {
        const label = labelForKey(key);
        const formatted = formatHumanValue(nested, depth + 1, key);
        return `${label}: ${formatted}`;
      })
      .join(" · ");
  }
  return String(value);
}

export function shortenPathForDisplay(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "";
  const relative = toHomeRelativePath(trimmed);
  const display = relative.startsWith("~/") ? relative : relative || trimmed;
  if (display.length <= 72) return display;
  return `…${display.slice(-68)}`;
}

/** Infere caminho/arquivo inspecionado por um script `execute_code`. */
export function extractScriptPathHint(rawArgs?: string): string | undefined {
  const trimmed = (rawArgs ?? "").trim();
  if (!trimmed.startsWith("{")) return undefined;
  let code = "";
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === "object" && parsed !== null && "code" in parsed) {
      const value = (parsed as { code?: unknown }).code;
      if (typeof value === "string") code = value;
    }
  } catch {
    return undefined;
  }
  if (!code.trim()) return undefined;

  const homeRel = code.match(/Path\.home\s*\(\s*\)\s*\/\s*['"]([^'"]+)['"]/);
  if (homeRel?.[1]) {
    const rel = homeRel[1].replace(/^\/+/, "");
    return shortenPathForDisplay(`~/${rel}`);
  }

  const patterns = [
    /(?:exists|isfile|isdir|getsize)\s*\(\s*['"]([^'"]+)['"]/i,
    /Path\s*\(\s*['"]([^'"]+)['"]\s*\)/,
    /Path\.home\s*\(\s*\)\s*\/\s*['"]([^'"]+)['"]/,
    /(?:path|file|filepath|target|arquivo)\s*=\s*(?:f)?['"]([^'"]+)['"]/i,
    /(?:path|file|filepath|target|arquivo)\s*=\s*Path\s*\(\s*['"]([^'"]+)['"]\s*\)/i,
    /open\s*\(\s*['"]([^'"]+)['"]/,
    /['"]([~./][^'"]{2,})['"]/,
  ];

  for (const pattern of patterns) {
    const match = code.match(pattern);
    const candidate = match?.[1]?.trim();
    if (candidate) return shortenPathForDisplay(candidate);
  }

  return undefined;
}

function humanizeScalarValue(value: string): string {
  const v = value.trim();
  if (/^(true|yes|sim|1)$/i.test(v)) return "sim";
  if (/^(false|no|nao|não|0)$/i.test(v) && v.length <= 5) return "não";
  if (/^none$/i.test(v)) return "—";
  if (/^null$/i.test(v)) return "—";
  if (/^success$/i.test(v)) return "concluído";
  if (/^failed?$/i.test(v)) return "falhou";
  if (/^errors?$/i.test(v)) return "erro";
  if (/^running$/i.test(v)) return "em andamento";
  if (/^pending$/i.test(v)) return "pendente";
  if (/^complete[d]?$/i.test(v)) return "concluído";
  if (/^interrupted$/i.test(v)) return "interrompido";
  if (/^timeout$/i.test(v)) return "tempo esgotado";
  if (/^not_found$/i.test(v)) return "não encontrado";
  if (/^killed$/i.test(v)) return "encerrado";
  return v;
}

function labelForKey(key: string): string {
  const lower = key.trim().toLowerCase();
  if (KEY_LABELS[lower]) return KEY_LABELS[lower]!;
  return key
    .replace(/_/g, " ")
    .replace(/([a-zà-ú])([A-Z])/g, "$1 $2")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function isTruthyValue(value: string): boolean {
  return /^(true|sim|yes|1|ok)$/i.test(value.trim());
}

function formatExistsLine(value: string, pathHint?: string): string {
  const yes = isTruthyValue(value);
  if (pathHint) {
    return yes ? `${pathHint}: encontrado` : `${pathHint}: não encontrado`;
  }
  return yes ? "Encontrado: sim" : "Encontrado: não";
}

function humanizeKvLine(
  key: string,
  value: unknown,
  options?: HumanizeScriptStdoutOptions,
): string {
  const keyLower = key.trim().toLowerCase();
  const pathHint = options?.pathHint;

  if (SKIP_KEYS.has(keyLower)) return "";

  if (typeof value === "object" && value !== null) {
    return `${labelForKey(key)}: ${formatHumanValue(value, 0, key)}`;
  }

  const rawValue = String(value ?? "").trim();
  const humanValue = humanizeScalarValue(rawValue);

  if (keyLower === "existe" || keyLower === "exists") {
    return formatExistsLine(rawValue, pathHint);
  }

  if (keyLower === "tamanho" || keyLower === "size") {
    const label = pathHint ? `Tamanho · ${pathHint}` : "Tamanho";
    return `${label}: ${humanValue}`;
  }

  if (
    keyLower === "path" ||
    keyLower === "caminho" ||
    keyLower === "file" ||
    keyLower === "arquivo" ||
    keyLower === "filepath"
  ) {
    return `${labelForKey(key)}: ${shortenPathForDisplay(rawValue)}`;
  }

  if (keyLower === "exit_code" || keyLower === "exit code" || keyLower === "codigo") {
    if (rawValue === "0") return "Comando concluído (código 0)";
    return `Comando falhou (código ${rawValue})`;
  }

  if (keyLower === "tool_calls_made") {
    const n = Number.parseInt(rawValue, 10);
    if (!Number.isFinite(n) || n <= 0) return "";
    return `${n} chamada${n === 1 ? "" : "s"} de ferramenta no script`;
  }

  if (
    keyLower === "duration_seconds" ||
    keyLower === "duration" ||
    keyLower === "duracao" ||
    keyLower === "duração" ||
    keyLower === "elapsed" ||
    keyLower === "elapsed_ms"
  ) {
    const n = Number.parseFloat(rawValue);
    if (!Number.isFinite(n)) return `${labelForKey(key)}: ${rawValue}`;
    const seconds = keyLower === "elapsed_ms" ? n / 1000 : n;
    return `Duração: ${seconds < 1 ? seconds.toFixed(2) : seconds.toFixed(1)}s`;
  }

  if (
    keyLower === "rows" ||
    keyLower === "matches" ||
    keyLower === "count" ||
    keyLower === "total"
  ) {
    const n = Number.parseInt(rawValue, 10);
    if (Number.isFinite(n)) {
      return `${labelForKey(key)}: ${n}`;
    }
  }

  if (keyLower === "status" || keyLower === "estado") {
    return `Status: ${humanValue}`;
  }

  if (keyLower === "success" || keyLower === "sucesso" || keyLower === "ok") {
    return isTruthyValue(rawValue) ? "Operação concluída" : "Operação falhou";
  }

  const parsedValue = tryParseJsonValue(rawValue);
  if (parsedValue !== null) {
    return `${labelForKey(key)}: ${formatHumanValue(parsedValue, 0, key)}`;
  }

  return `${labelForKey(key)}: ${humanValue}`;
}

/** Humaniza linhas `chave: valor` comuns em stdout de scripts do agente. */
export function humanizeScriptStdout(
  output: string,
  options?: HumanizeScriptStdoutOptions,
): string {
  return output
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return "";
      if (trimmed === "{" || trimmed === "}" || trimmed === "[" || trimmed === "]") {
        return "";
      }

      if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
        try {
          const parsed: unknown = JSON.parse(trimmed);
          if (typeof parsed === "object" && parsed !== null) {
            return Object.entries(parsed as Record<string, unknown>)
              .map(([k, v]) => humanizeKvLine(k, v, options))
              .filter(Boolean)
              .join("\n");
          }
        } catch {
          /* fall through */
        }
      }

      const kv = trimmed.match(/^([^:=]{1,64})(?::|=)\s*(.+)$/);
      if (!kv) {
        if (/^(true|false)$/i.test(trimmed)) {
          return humanizeScalarValue(trimmed);
        }
        return trimmed;
      }

      const parsedKvValue = tryParseJsonValue(kv[2]);
      return humanizeKvLine(kv[1], parsedKvValue ?? kv[2], options);
    })
    .filter(Boolean)
    .join("\n");
}
