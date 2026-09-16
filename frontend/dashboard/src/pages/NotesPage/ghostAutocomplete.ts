import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorView } from "@tiptap/pm/view";

// Autocomplete de escrita nas Notas: texto fantasma estilo Cursor. Ao pausar,
// pede a continuacao ao backend e mostra em cinza depois do cursor (uma
// Decoration.widget, sem tocar no doc). Tab insere; Esc/digitar/mover descarta.
// Cancela a requisicao em voo a cada tecla. So dispara no fim de um bloco e fora
// de codigo. A flag e lida por funcao (ref) a cada disparo, entao ligar/desligar
// vale na hora sem remontar o editor (deps do useEditor sao so [noteId]).

interface GhostState {
  text: string | null;
  pos: number;
}

export interface GhostAutocompleteOptions {
  /** Lido a cada disparo — reflete o toggle sem remontar o editor. */
  enabled: () => boolean;
  /** Busca a continuação; `signal` cancela ao digitar. */
  fetchCompletion: (args: {
    prefix: string;
    suffix: string;
    /** Tipo do bloco onde o cursor está (bullet_item, task_item, heading…). */
    context: string;
    signal: AbortSignal;
  }) => Promise<string>;
  /** Espera após parar de digitar antes de pedir (ms). */
  debounceMs: number;
}

export const ghostKey = new PluginKey<GhostState>("ghostAutocomplete");

const EMPTY: GhostState = { text: null, pos: 0 };

/** Prefixo enviado ao backend — o suficiente pra dar contexto sem exagero. */
const PREFIX_MAX = 2000;
const SUFFIX_MAX = 500;

function currentGhost(state: EditorState): GhostState {
  return (ghostKey.getState(state) as GhostState) ?? EMPTY;
}

/**
 * Tipo do bloco onde o cursor está — vira "inteligência de formatação" no
 * backend (continuar um item de lista/checkbox/heading, sem marcador literal).
 */
function describeContext($from: EditorState["selection"]["$from"]): string {
  for (let d = $from.depth; d > 0; d -= 1) {
    const name = $from.node(d).type.name;
    if (name === "taskItem") return "task_item";
    if (name === "listItem") {
      const parent = d > 0 ? $from.node(d - 1) : null;
      return parent?.type.name === "orderedList"
        ? "ordered_item"
        : "bullet_item";
    }
    if (name === "heading") return "heading";
    if (name === "blockquote") return "quote";
  }
  return "paragraph";
}

/** A sugestão só vale se o cursor ainda está exatamente onde ela nasceu. */
function ghostVisible(state: EditorState): GhostState | null {
  const st = currentGhost(state);
  if (st.text === null) return null;
  const sel = state.selection;
  if (!sel.empty || sel.from !== st.pos) return null;
  return st;
}

function createGhostPlugin(options: GhostAutocompleteOptions): Plugin<GhostState> {
  let timer: number | undefined;
  let abort: AbortController | null = null;
  let reqId = 0;

  const cancelPending = () => {
    if (timer) {
      window.clearTimeout(timer);
      timer = undefined;
    }
    if (abort) {
      abort.abort();
      abort = null;
    }
    reqId += 1; // invalida qualquer resposta em voo
  };

  const scheduleFetch = (view: EditorView) => {
    cancelPending();
    if (!options.enabled()) return;
    if (!view.hasFocus()) return;

    const state = view.state;
    const sel = state.selection;
    if (!sel.empty) return; // seleção de trecho, não cursor

    const $from = sel.$from;
    if ($from.parent.type.spec.code) return; // dentro de bloco de código

    // Só no FIM do bloco: se há texto à frente na mesma linha, completar ali
    // seria enfiar no meio da frase.
    const afterInBlock = $from.parent.textBetween(
      $from.parentOffset,
      $from.parent.content.size,
    );
    if (afterInBlock.trim().length > 0) return;

    const prefixFull = state.doc.textBetween(0, sel.from, "\n", "\n");
    if (prefixFull.trim().length < 3) return;
    const prefix = prefixFull.slice(-PREFIX_MAX);
    const suffix = state.doc
      .textBetween(sel.from, state.doc.content.size, "\n", "\n")
      .slice(0, SUFFIX_MAX);

    const context = describeContext($from);
    const myReq = reqId;
    const posAtRequest = sel.from;

    timer = window.setTimeout(() => {
      const controller = new AbortController();
      abort = controller;
      void options
        .fetchCompletion({ prefix, suffix, context, signal: controller.signal })
        .then((text) => {
          if (myReq !== reqId) return; // superado por nova digitação
          const cur = view.state.selection;
          if (!cur.empty || cur.from !== posAtRequest) return; // cursor mudou
          const trimmed = (text || "").length ? text : "";
          if (!trimmed) {
            if (currentGhost(view.state).text !== null) {
              view.dispatch(view.state.tr.setMeta(ghostKey, null));
            }
            return;
          }
          view.dispatch(
            view.state.tr.setMeta(ghostKey, { text: trimmed, pos: posAtRequest }),
          );
        })
        .catch(() => {
          // Abortado ou falhou — silencioso; o fantasma simplesmente não aparece.
        });
    }, options.debounceMs);
  };

  return new Plugin<GhostState>({
    key: ghostKey,
    state: {
      init: () => EMPTY,
      apply(tr, prev) {
        const meta = tr.getMeta(ghostKey);
        if (meta !== undefined) {
          return (meta as GhostState | null) ?? EMPTY;
        }
        // Documento ou seleção mudou → a sugestão atual não vale mais.
        if ((tr.docChanged || tr.selectionSet) && prev.text !== null) {
          return EMPTY;
        }
        return prev;
      },
    },
    props: {
      decorations(state) {
        const st = ghostVisible(state);
        if (!st) return DecorationSet.empty;
        const widget = Decoration.widget(
          st.pos,
          () => {
            const span = document.createElement("span");
            span.className = "ghost-suggestion";
            span.textContent = st.text ?? "";
            return span;
          },
          { side: 1, ignoreSelection: true, key: `ghost-${st.text}` },
        );
        return DecorationSet.create(state.doc, [widget]);
      },
      handleKeyDown(view, event) {
        const st = ghostVisible(view.state);
        if (!st) return false;
        if (event.key === "Tab") {
          event.preventDefault();
          cancelPending();
          const tr = view.state.tr.insertText(st.text ?? "", st.pos);
          tr.setMeta(ghostKey, null);
          view.dispatch(tr);
          return true;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          cancelPending();
          view.dispatch(view.state.tr.setMeta(ghostKey, null));
          return true;
        }
        return false;
      },
    },
    view() {
      return {
        update(view, prevState) {
          // Só reage a mudança real de doc/seleção — nossa própria transação
          // que SETA o fantasma (meta-only) não deve reagendar (evita laço).
          if (
            view.state.doc.eq(prevState.doc) &&
            view.state.selection.eq(prevState.selection)
          ) {
            return;
          }
          scheduleFetch(view);
        },
        destroy() {
          cancelPending();
        },
      };
    },
  });
}

export const GhostAutocomplete = Extension.create<GhostAutocompleteOptions>({
  name: "ghostAutocomplete",
  addOptions() {
    return {
      enabled: () => false,
      fetchCompletion: async () => "",
      debounceMs: 450,
    };
  },
  addProseMirrorPlugins() {
    return [createGhostPlugin(this.options)];
  },
});
