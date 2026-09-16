/** Steer (fala do usuário no meio do turno) materializado no histórico. */
export interface SteerNote {
  text: string;
  /**
   * Momento da leitura — timestamp do resultado da ferramenta que a carregou.
   * Mesma unidade das mensagens (segundos ou ms; ``tempoRelativo`` normaliza),
   * então a bolha mostra a hora igual a qualquer outra fala do usuário.
   */
  at?: number;
}

export interface ToolCallEvent {
  id: string;
  /** ID do servidor (OpenAI tool_call id) para correlacionar start/complete. */
  serverId?: string;
  name: string;
  args: string;
  /** Rótulo ao vivo enviado pelo backend (preview/descrição). */
  liveLabel?: string;
  /** Linha técnica ao vivo (ex.: comando shell). */
  liveTechnical?: string;
  /** JSON bruto do resultado da ferramenta (quando disponível). */
  result?: string;
  /** ID do processo em `process_registry` quando `terminal(background=true)`. */
  backgroundProcId?: string;
  /** Momento em que a tool entrou em `running` (ms) — contagem regressiva de wait. */
  startedAt?: number;
  status: "running" | "complete" | "error";
  /** Resultado omitido no SSE por tamanho (>8KB); corpo completo só no histórico. */
  resultTruncated?: boolean;
  /**
   * Mensagens de "steer" (enviadas pelo usuário durante o turno) que o backend
   * anexou ao ``content`` deste resultado. Extraídas na leitura do histórico
   * (ver steerMarker.ts) para renderizar como bolha de usuário no ponto em que
   * o agente as leu — logo após esta ferramenta.
   */
  steers?: SteerNote[];
}

export interface ChatMessageAttachment {
  id: string;
  name: string;
  kind?: "image" | "document";
  /** Blob/object URL while composing; persisted history uses ``url``. */
  previewUrl?: string;
  /** Server URL from ``/api/chat/images/...`` after reload. */
  url?: string;
}

export type ReasoningSegment = {
  kind: "reasoning";
  id: string;
  content: string;
  startedAt: number;
  endedAt?: number;
  streaming?: boolean;
  label?: string;
};

export type TurnSegment =
  | { kind: "text"; content: string }
  | { kind: "tools"; toolCalls: ToolCallEvent[] }
  | { kind: "attachments"; attachments: ChatMessageAttachment[] }
  | { kind: "plan" }
  | ReasoningSegment;

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  /**
   * Estado de uma mensagem enviada COM o agente já respondendo.
   *
   * `"queued"` — entregue ao turno, ainda não lida pelo agente.
   * `"read"`   — o agente já a incorporou e está respondendo com ela em conta.
   *
   * Ausente na esmagadora maioria: mensagem enviada com o agente parado nunca
   * passa por este estado.
   */
  steerState?: "queued" | "read";
  timestamp?: number;
  /** Client wall-clock (ms) when the turn finished; survives server resync. */
  turnCompletedAt?: number;
  /** Tokens GERADOS (saída) do turno, vindos do SSE USAGE. Quando presente, o
   *  rodapé usa este número (estilo Claude) em vez da estimativa. */
  usageTokens?: number;
  /** Entrada e total do turno (soma de todas as chamadas) — só pro tooltip do
   *  rodapé. Ao vivo (USAGE); no reload só a saída sobrevive. */
  usageInput?: number;
  usageTotal?: number;
  toolCalls?: ToolCallEvent[];
  /** Chronological turn layout — text and tool cards interleaved. */
  segments?: TurnSegment[];
  /** Uncommitted assistant narration before the next tool or DONE. */
  streamingBuffer?: string;
  statusText?: string;
  /** True after CHAT_STREAM_SOFT_STALL_MS of no server activity mid-turn —
   * shows a "still waiting" hint distinct from normal loading dots. */
  stalled?: boolean;
  attachments?: ChatMessageAttachment[];
  /** run_mode ("code"/"inicio"/…) carimbado no envio — gate do indicador
   *  "Planejando os próximos passos" (só modo Code). */
  runMode?: import("@/lib/composerRunMode").ComposerRunMode;
  /** Latest todo tool snapshot for the turn (anchor live). */
  todoSnapshot?: import("@/lib/todoToolResult").TodoToolResult;
  /** Frozen plan artifact for this planning turn. */
  planSnapshot?: import("@/lib/planExecuteOffer").PlanMessageSnapshot;
  /** Raciocínio/planejamento acumulado via SSE THINKING/REASONING (não persiste no histórico). */
  reasoning?: {
    content: string;
    startedAt?: number;
    endedAt?: number;
    label?: string;
    /** True enquanto deltas de raciocínio chegam via SSE. */
    streaming?: boolean;
  };
}
