/**
 * Extração de mensagens de "steer" embutidas em resultados de ferramenta.
 *
 * Quando o usuário envia uma mensagem ENQUANTO o agente trabalha (steer), o
 * backend não pode inserir uma nova mensagem de usuário no meio do turno sem
 * quebrar a alternância de papéis exigida pela API. A saída encontrada foi
 * anexar o texto ao ``content`` do ÚLTIMO resultado de ferramenta do lote, com
 * um marcador bem distinto (ver ``_steer_marker`` em run_agent.py). Isso
 * persiste no histórico — mas, cru, aparece como lixo dentro da saída da
 * ferramenta e a bolha efêmera "na fila" some ao recarregar.
 *
 * Aqui a gente desfaz isso na LEITURA do histórico: separa o texto do usuário
 * do resultado real da ferramenta, para renderizar o steer como a bolha de
 * usuário que ele sempre foi, no ponto exato em que o agente o leu.
 */

/** Cabeçalho literal do marcador — usado como fast-path e como sentinela. */
export const STEER_MARKER_HEADER =
  "[MESSAGE FROM THE USER — sent while you were working, not tool output]";

// Espelha `_steer_marker` (run_agent.py). O rodapé é texto constante —
// ancorar nele delimita cada bloco com precisão e evita comer saída legítima
// da ferramenta. `steerMarker.test.ts` guarda contra divergência de redação.
const STEER_BLOCK_RE =
  /\n*---\n\[MESSAGE FROM THE USER — sent while you were working, not tool output\]\n([\s\S]*?)\n---\nAcknowledge this in one short line, then fold it into what you are doing\. If you were about to finish, handle this request before ending the turn — do not leave it for later\./g;

export interface SteerExtraction {
  /** Resultado da ferramenta sem os blocos de steer. */
  cleaned: string;
  /** Textos de steer, na ordem em que aparecem no resultado. */
  steers: string[];
}

/** True se o resultado carrega ao menos um marcador de steer. */
export function toolResultHasSteer(
  content: string | undefined | null,
): boolean {
  return !!content && content.includes(STEER_MARKER_HEADER);
}

/**
 * Separa os steers embutidos do resultado real da ferramenta.
 *
 * Fast-path: sem o cabeçalho, devolve o conteúdo intacto sem tocar no regex —
 * o caso esmagadoramente comum (nenhum steer no turno).
 */
export function extractSteerMessages(
  content: string | undefined | null,
): SteerExtraction {
  const text = content ?? "";
  if (!text.includes(STEER_MARKER_HEADER)) {
    return { cleaned: text, steers: [] };
  }
  const steers: string[] = [];
  const cleaned = text.replace(STEER_BLOCK_RE, (_match, steerText: string) => {
    const trimmed = String(steerText).trim();
    if (trimmed) steers.push(trimmed);
    return "";
  });
  return { cleaned: cleaned.trimEnd(), steers };
}
