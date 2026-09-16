import type { Editor, Range } from "@tiptap/core";
import type { SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion";

/**
 * Item genérico de um menu de sugestão (barra "/", vínculo "[["…).
 * `run` executa a ação já com o range do gatilho (o "/foo" digitado) para
 * apagá-lo antes de inserir.
 */
export interface SuggestItem {
  id: string;
  title: string;
  subtitle?: string;
  icon?: string; // 1–2 caracteres (emoji) — leve, sem componente React aqui
  run: (editor: Editor, range: Range) => void;
}

/**
 * Popup de sugestão em DOM puro (sem tippy nem React-root por instância): o
 * TipTap chama estes callbacks e nós posicionamos uma lista flutuante no cursor.
 * Segue o tema do app (superfície de popover, sem sombra) e navega por teclado.
 */
export function createSuggestionRenderer() {
  let el: HTMLDivElement | null = null;
  let items: SuggestItem[] = [];
  let selected = 0;
  let onPick: (item: SuggestItem) => void = () => {};

  function ensureEl(): HTMLDivElement {
    if (el) return el;
    el = document.createElement("div");
    el.className =
      "fixed z-[130] max-h-72 w-64 overflow-y-auto rounded-lg border border-solid " +
      "border-(--border-strong) bg-(--popover-bg) p-1 text-sm shadow-none";
    document.body.appendChild(el);
    return el;
  }

  function render() {
    const box = ensureEl();
    box.innerHTML = "";
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "px-2 py-1.5 text-xs text-muted-foreground";
      empty.textContent = "Nada encontrado";
      box.appendChild(empty);
      return;
    }
    items.forEach((item, i) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className =
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors " +
        (i === selected
          ? "bg-(--surface-hover) text-foreground"
          : "text-muted-foreground hover:bg-(--surface-hover) hover:text-foreground");
      if (item.icon) {
        const ic = document.createElement("span");
        ic.className = "w-4 shrink-0 text-center text-primary";
        ic.textContent = item.icon;
        row.appendChild(ic);
      }
      const texts = document.createElement("span");
      texts.className = "flex min-w-0 flex-col";
      const t = document.createElement("span");
      t.className = "truncate text-foreground";
      t.textContent = item.title;
      texts.appendChild(t);
      if (item.subtitle) {
        const s = document.createElement("span");
        s.className = "truncate text-xs text-muted-foreground";
        s.textContent = item.subtitle;
        texts.appendChild(s);
      }
      row.appendChild(texts);
      // mousedown (não click) para não roubar o foco do editor antes da ação.
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        onPick(item);
      });
      box.appendChild(row);
    });
  }

  function position(rect: DOMRect | null) {
    if (!el || !rect) return;
    const margin = 6;
    const h = el.offsetHeight;
    const below = rect.bottom + margin;
    const openUp = below + h > window.innerHeight && rect.top > h + margin;
    el.style.left = `${Math.round(rect.left)}px`;
    el.style.top = openUp
      ? `${Math.round(rect.top - h - margin)}px`
      : `${Math.round(below)}px`;
  }

  function destroy() {
    el?.remove();
    el = null;
  }

  return {
    onStart(props: SuggestionProps<SuggestItem>) {
      items = props.items;
      selected = 0;
      onPick = (item) => props.command(item);
      render();
      position(props.clientRect?.() ?? null);
    },
    onUpdate(props: SuggestionProps<SuggestItem>) {
      items = props.items;
      if (selected >= items.length) selected = Math.max(0, items.length - 1);
      onPick = (item) => props.command(item);
      render();
      position(props.clientRect?.() ?? null);
    },
    onKeyDown(props: SuggestionKeyDownProps): boolean {
      const { key } = props.event;
      if (key === "ArrowDown") {
        selected = (selected + 1) % Math.max(1, items.length);
        render();
        return true;
      }
      if (key === "ArrowUp") {
        selected = (selected - 1 + items.length) % Math.max(1, items.length);
        render();
        return true;
      }
      if (key === "Enter") {
        const item = items[selected];
        if (item) onPick(item);
        return true;
      }
      if (key === "Escape") {
        destroy();
        return true;
      }
      return false;
    },
    onExit() {
      destroy();
    },
  };
}
