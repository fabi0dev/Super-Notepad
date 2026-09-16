import { useEffect, useState } from "react";
import { History, RotateCcw } from "lucide-react";
import { api, type Note, type NoteVersion } from "@/lib/api";
import {
  Modal,
  ModalPanel,
  ModalHeader,
  ModalBody,
  ModalFooter,
  useModalEscape,
} from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** "há 2 min", "há 3 h", "ontem 14:20", "27/08 09:15". */
function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diff = Math.max(0, Date.now() - d.getTime());
  const min = Math.floor(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const hhmm = d.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const dia = Math.floor(h / 24);
  if (dia === 1) return `ontem ${hhmm}`;
  return `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${hhmm}`;
}

/** Hora exata "14:07" (desempata as várias versões "há 1 min"). */
function fmtClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/** Data + hora por extenso, para o cabeçalho da pré-visualização. */
function fmtFull(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Tira os marcadores inline (**, *, `) para o texto não mostrar os símbolos. */
function stripInline(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(?<!\*)\*(?!\s)(.+?)\*/g, "$1")
    .replace(/`(.+?)`/g, "$1");
}

/**
 * Pré-visualização LEVE do markdown da versão — sem puxar o renderizador do
 * chat (pesado). Só o essencial de uma nota: títulos, listas e checklists,
 * com hierarquia visual em vez do markdown cru (# ## -). É display puro.
 */
function PreviewContent({ md }: { md: string }) {
  const lines = (md || "").replace(/\r\n/g, "\n").split("\n");
  return (
    <div className="text-sm leading-relaxed text-foreground">
      {lines.map((line, i) => {
        if (!line.trim()) return <div key={i} className="h-2.5" aria-hidden />;
        const heading = /^(#{1,4})\s+(.*)$/.exec(line);
        if (heading) {
          const lvl = heading[1].length;
          return (
            <div
              key={i}
              className={cn(
                "font-semibold text-foreground",
                lvl <= 1 ? "text-base" : lvl === 2 ? "text-[0.95rem]" : "text-sm",
                i > 0 && "mt-2",
              )}
            >
              {stripInline(heading[2])}
            </div>
          );
        }
        const task = /^(\s*)[-*]\s+\[([ xX])\]\s+(.*)$/.exec(line);
        if (task) {
          const indent = Math.floor(task[1].replace(/\t/g, "  ").length / 2);
          const done = task[2].toLowerCase() === "x";
          return (
            <div
              key={i}
              className="flex gap-2 py-0.5"
              style={{ paddingLeft: `${indent * 1.1 + 0.1}rem` }}
            >
              <span className={done ? "text-primary" : "text-muted-foreground/70"}>
                {done ? "☑" : "☐"}
              </span>
              <span className={done ? "text-muted-foreground line-through" : ""}>
                {stripInline(task[3])}
              </span>
            </div>
          );
        }
        const bullet = /^(\s*)[-*]\s+(.*)$/.exec(line);
        if (bullet) {
          const indent = Math.floor(bullet[1].replace(/\t/g, "  ").length / 2);
          return (
            <div
              key={i}
              className="flex gap-2 py-0.5"
              style={{ paddingLeft: `${indent * 1.1 + 0.1}rem` }}
            >
              <span className="select-none text-muted-foreground/50">
                {indent > 0 ? "◦" : "•"}
              </span>
              <span>{stripInline(bullet[2])}</span>
            </div>
          );
        }
        return (
          <div key={i} className="py-0.5">
            {stripInline(line)}
          </div>
        );
      })}
    </div>
  );
}

/** Deixa o markdown legível para o diff: tira marcadores de título e vira os
 *  bullets em "• "/"◦ ", preservando a estrutura por linha. */
function cleanForDiff(md: string): string {
  return (md || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => {
      const heading = /^(#{1,4})\s+(.*)$/.exec(line);
      if (heading) return stripInline(heading[2]);
      const task = /^(\s*)[-*]\s+\[([ xX])\]\s+(.*)$/.exec(line);
      if (task) {
        const done = task[2].toLowerCase() === "x";
        return `${task[1]}${done ? "☑" : "☐"} ${stripInline(task[3])}`;
      }
      const bullet = /^(\s*)[-*]\s+(.*)$/.exec(line);
      if (bullet)
        return `${bullet[1]}${bullet[1].length ? "◦" : "•"} ${stripInline(bullet[2])}`;
      return stripInline(line);
    })
    .join("\n");
}

/** Quebra em tokens preservando espaços e quebras de linha como tokens próprios
 *  (assim o diff é por PALAVRA, não por caractere, e a estrutura é mantida). */
function tokenize(s: string): string[] {
  return s.match(/\n|[^\S\n]+|[^\s]+/g) ?? [];
}

type DiffOp = { type: "eq" | "add" | "del"; text: string };

/** Diff por palavra via LCS. Cap de segurança: notas gigantes caem no modo
 *  linha (bem menos tokens) para não estourar memória na tabela DP. */
function diffTokens(oldStr: string, newStr: string): DiffOp[] {
  let a = tokenize(oldStr);
  let b = tokenize(newStr);
  if (a.length * b.length > 1_200_000) {
    // Fallback por linha: muito menos elementos que por palavra.
    a = oldStr.split("\n");
    b = newStr.split("\n");
    return lcs(a, b).map((op) => ({
      ...op,
      text: op.text + "\n",
    }));
  }
  return lcs(a, b);
}

/** Diferença por LCS entre dois arrays de tokens. */
function lcs(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  const dp: Int32Array[] = Array.from(
    { length: n + 1 },
    () => new Int32Array(m + 1),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "eq", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: "del", text: a[i] });
      i++;
    } else {
      out.push({ type: "add", text: b[j] });
      j++;
    }
  }
  while (i < n) out.push({ type: "del", text: a[i++] });
  while (j < m) out.push({ type: "add", text: b[j++] });
  return out;
}

/**
 * Diff visual entre a versão anterior (`oldMd`) e a selecionada (`newMd`):
 * adicionado em verde, removido em vermelho tachado, resto neutro. Espaços e
 * quebras de linha nunca são realçados (evita blocos coloridos feios).
 */
function DiffContent({ oldMd, newMd }: { oldMd: string; newMd: string }) {
  const ops = diffTokens(cleanForDiff(oldMd), cleanForDiff(newMd));
  const added = ops.some((o) => o.type === "add");
  const removed = ops.some((o) => o.type === "del");
  return (
    <div>
      {!added && !removed ? (
        <p className="mb-3 text-xs text-muted-foreground">
          Nada mudou em relação à versão anterior.
        </p>
      ) : null}
      <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
        {ops.map((op, i) => {
          const isSpace = !op.text.trim();
          if (op.type === "eq" || isSpace) {
            return <span key={i}>{op.text}</span>;
          }
          if (op.type === "add") {
            return (
              <span
                key={i}
                className="rounded-sm bg-emerald-500/15 text-emerald-600 dark:text-emerald-300"
              >
                {op.text}
              </span>
            );
          }
          return (
            <span
              key={i}
              className="rounded-sm bg-red-500/12 text-red-500 line-through decoration-red-500/50 dark:text-red-300"
            >
              {op.text}
            </span>
          );
        })}
      </div>
    </div>
  );
}

interface NoteHistoryModalProps {
  noteId: string;
  noteTitle: string;
  open: boolean;
  onClose: () => void;
  /** Chamado após restaurar — o pai recarrega a nota com o conteúdo restaurado. */
  onRestored: (note: Note) => void;
}

/**
 * Linha do tempo da nota: toda alteração salva vira uma versão restaurável.
 *
 * É a rede de segurança contra perda de conteúdo. O agente NUNCA vê isto — o
 * histórico é só do painel; contexto e autocomplete usam sempre a versão atual.
 */
export function NoteHistoryModal({
  noteId,
  noteTitle,
  open,
  onClose,
  onRestored,
}: NoteHistoryModalProps) {
  const panelRef = useModalEscape(onClose, open);
  const [versions, setVersions] = useState<NoteVersion[] | null>(null);
  const [selectedTs, setSelectedTs] = useState<string | null>(null);
  const [preview, setPreview] = useState<string>("");
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [restoring, setRestoring] = useState(false);
  // "content" = versão renderizada; "diff" = alterações vs a versão anterior.
  const [viewMode, setViewMode] = useState<"content" | "diff">("content");
  const [prevContent, setPrevContent] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setVersions(null);
    setSelectedTs(null);
    setPreview("");
    setViewMode("content");
    let alive = true;
    void api
      .notesHistory(noteId)
      .then((r) => {
        if (!alive) return;
        setVersions(r.versions);
        if (r.versions[0]) setSelectedTs(r.versions[0].ts);
      })
      .catch(() => {
        if (alive) setVersions([]);
      });
    return () => {
      alive = false;
    };
  }, [open, noteId]);

  useEffect(() => {
    if (!open || !selectedTs) return;
    let alive = true;
    setLoadingPreview(true);
    void api
      .notesHistoryVersion(noteId, selectedTs)
      .then((r) => {
        if (alive) setPreview(r.content);
      })
      .catch(() => {
        if (alive) setPreview("");
      })
      .finally(() => {
        if (alive) setLoadingPreview(false);
      });
    return () => {
      alive = false;
    };
  }, [open, noteId, selectedTs]);

  // Versão imediatamente ANTERIOR à selecionada (a lista é do mais novo pro
  // mais antigo, então a anterior é o próximo índice). É contra ela que o diff
  // compara — mostrando o que mudou NESTA versão.
  const selectedIndex = versions
    ? versions.findIndex((v) => v.ts === selectedTs)
    : -1;
  const prevTs =
    selectedIndex >= 0 && versions
      ? versions[selectedIndex + 1]?.ts
      : undefined;
  const canDiff = Boolean(prevTs);
  const showDiff = viewMode === "diff" && canDiff;

  // Busca o conteúdo da versão anterior só quando o diff está ativo.
  useEffect(() => {
    if (!open || !showDiff || !prevTs) {
      setPrevContent(null);
      return;
    }
    let alive = true;
    void api
      .notesHistoryVersion(noteId, prevTs)
      .then((r) => {
        if (alive) setPrevContent(r.content);
      })
      .catch(() => {
        if (alive) setPrevContent("");
      });
    return () => {
      alive = false;
    };
  }, [open, noteId, prevTs, showDiff]);

  const restore = async () => {
    if (!selectedTs || restoring) return;
    setRestoring(true);
    try {
      const note = await api.notesHistoryRestore(noteId, selectedTs);
      onRestored(note);
      onClose();
    } catch {
      // silencioso — a nota atual permanece intacta
    } finally {
      setRestoring(false);
    }
  };

  const isNewest = versions && selectedTs === versions[0]?.ts;

  return (
    <Modal open={open} onBackdropClick={onClose} align="center">
      <ModalPanel
        ref={panelRef}
        className="max-w-3xl"
        labelledBy="note-history-title"
      >
        <ModalHeader
          title={
            <span className="flex items-center gap-2">
              <History className="h-4 w-4 text-muted-foreground" aria-hidden />
              Linha do tempo
            </span>
          }
          subtitle={`Versões de "${noteTitle || "Sem título"}" — restaure qualquer estado anterior.`}
          onClose={onClose}
          titleId="note-history-title"
        />
        <ModalBody className="px-0 pb-0">
          <div className="flex h-[26rem] min-h-0">
            {/* Lista de versões (rail à esquerda) */}
            <div className="ui-scrollbar w-64 shrink-0 overflow-y-auto border-r border-(--divider) py-2">
              {versions === null ? (
                <p className="px-4 py-3 text-xs text-muted-foreground">
                  Carregando…
                </p>
              ) : versions.length === 0 ? (
                <p className="px-4 py-3 text-xs text-muted-foreground">
                  Ainda não há versões salvas desta nota.
                </p>
              ) : (
                <ul className="flex flex-col">
                  {versions.map((v, i) => {
                    const active = v.ts === selectedTs;
                    const older = versions[i + 1];
                    const delta = older ? v.chars - older.chars : null;
                    return (
                      <li key={v.ts}>
                        <button
                          type="button"
                          onClick={() => setSelectedTs(v.ts)}
                          className={cn(
                            "flex w-full flex-col items-start gap-0.5 px-4 py-2 text-left transition-colors",
                            active
                              ? "bg-(--primary-muted)"
                              : "hover:bg-(--surface-hover)",
                          )}
                        >
                          <span className="flex w-full items-center gap-2">
                            <span
                              aria-hidden
                              className={cn(
                                "h-1.5 w-1.5 shrink-0 rounded-full",
                                active ? "bg-primary" : "bg-muted-foreground/40",
                              )}
                            />
                            <span
                              className={cn(
                                "text-xs font-medium",
                                active ? "text-primary" : "text-foreground",
                              )}
                            >
                              {fmtWhen(v.ts)}
                            </span>
                            {i === 0 ? (
                              <span className="ml-auto rounded bg-(--surface) px-1.5 py-0.5 text-[0.65rem] text-muted-foreground">
                                atual
                              </span>
                            ) : null}
                          </span>
                          <span className="flex w-full items-center gap-1.5 pl-3.5 text-[0.7rem] text-muted-foreground">
                            <span className="tabular-nums">{fmtClock(v.ts)}</span>
                            <span aria-hidden className="text-muted-foreground/40">
                              ·
                            </span>
                            <span className="tabular-nums">{v.chars} car.</span>
                            {delta !== null && delta !== 0 ? (
                              <span
                                className={cn(
                                  "ml-auto rounded px-1 py-px text-[0.65rem] font-medium tabular-nums",
                                  delta > 0
                                    ? "bg-emerald-500/12 text-emerald-500"
                                    : "bg-red-500/12 text-red-400",
                                )}
                                title={`${delta > 0 ? "adicionou" : "removeu"} ${Math.abs(delta)} caracteres`}
                              >
                                {delta > 0 ? `+${delta}` : delta}
                              </span>
                            ) : null}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Pré-visualização da versão selecionada */}
            <div className="ui-scrollbar min-w-0 flex-1 overflow-y-auto bg-background">
              {loadingPreview ? (
                <p className="px-5 py-4 text-xs text-muted-foreground">
                  Carregando…
                </p>
              ) : preview ? (
                <>
                  {selectedTs ? (
                    <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-solid border-(--divider) bg-background/95 px-5 py-2 backdrop-blur">
                      <span className="text-[0.7rem] font-medium text-muted-foreground">
                        {isNewest
                          ? "Versão atual"
                          : `Versão de ${fmtFull(selectedTs)}`}
                      </span>
                      {canDiff ? (
                        <div className="ml-auto flex items-center gap-0.5 rounded-md bg-(--surface) p-0.5 text-[0.7rem]">
                          <button
                            type="button"
                            onClick={() => setViewMode("content")}
                            className={cn(
                              "rounded px-2 py-0.5 transition-colors",
                              viewMode === "content"
                                ? "bg-(--primary-muted) text-primary"
                                : "text-muted-foreground hover:text-foreground",
                            )}
                          >
                            Conteúdo
                          </button>
                          <button
                            type="button"
                            onClick={() => setViewMode("diff")}
                            className={cn(
                              "rounded px-2 py-0.5 transition-colors",
                              viewMode === "diff"
                                ? "bg-(--primary-muted) text-primary"
                                : "text-muted-foreground hover:text-foreground",
                            )}
                          >
                            Alterações
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="px-5 py-4">
                    {showDiff ? (
                      prevContent === null ? (
                        <p className="text-xs text-muted-foreground">
                          Comparando…
                        </p>
                      ) : (
                        <DiffContent oldMd={prevContent} newMd={preview} />
                      )
                    ) : (
                      <PreviewContent md={preview} />
                    )}
                  </div>
                </>
              ) : (
                <p className="px-5 py-4 text-xs text-muted-foreground">
                  Selecione uma versão para pré-visualizar.
                </p>
              )}
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
          <Button
            onClick={restore}
            disabled={!selectedTs || Boolean(isNewest) || restoring}
          >
            <RotateCcw className="mr-1.5 h-4 w-4" />
            {isNewest ? "Já é a versão atual" : "Restaurar esta versão"}
          </Button>
        </ModalFooter>
      </ModalPanel>
    </Modal>
  );
}
