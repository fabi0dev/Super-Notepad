import { Extension, type Editor, type Range } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion from "@tiptap/suggestion";
import { api } from "@/lib/api";
import { createSuggestionRenderer, type SuggestItem } from "./suggestionRenderer";

/** Esquema de href usado nos vínculos entre notas — round-trip como Markdown. */
export const NOTE_LINK_SCHEME = "sn-note";

interface WikiLinkOptions {
  /** Chamado ao criar uma nota nova a partir de um vínculo inexistente. */
  onCreateNote?: (title: string) => Promise<{ id: string } | null>;
}

// Cache curto das notas — evita bater na API a cada tecla do "[[".
let cache: { at: number; notes: { id: string; title: string }[] } | null = null;

async function loadNotes(): Promise<{ id: string; title: string }[]> {
  const now = Date.now();
  if (cache && now - cache.at < 4000) return cache.notes;
  try {
    const { notes } = await api.notesList();
    const list = notes.map((n) => ({ id: n.id, title: n.title }));
    cache = { at: now, notes: list };
    return list;
  } catch {
    return cache?.notes ?? [];
  }
}

/** Invalida o cache (após criar/renomear) para o autocomplete refletir logo. */
export function invalidateWikiCache() {
  cache = null;
}

function insertLink(editor: Editor, range: Range, id: string, title: string) {
  editor
    .chain()
    .focus()
    .deleteRange(range)
    .insertContent([
      {
        type: "text",
        text: title,
        marks: [{ type: "link", attrs: { href: `${NOTE_LINK_SCHEME}:${id}` } }],
      },
      { type: "text", text: " " },
    ])
    .run();
}

export function wikiLink(options: WikiLinkOptions = {}) {
  return Extension.create({
    name: "wikiLink",
    addProseMirrorPlugins() {
      return [
        Suggestion<SuggestItem>({
          editor: this.editor,
          pluginKey: new PluginKey("wikiLink"),
          char: "[[",
          startOfLine: false,
          items: async ({ query }) => {
            const q = query.toLowerCase().trim();
            const notes = await loadNotes();
            const matches = notes
              .filter((n) => !q || n.title.toLowerCase().includes(q))
              .slice(0, 8)
              .map<SuggestItem>((n) => ({
                id: n.id,
                title: n.title,
                icon: "📝",
                run: (editor, range) => insertLink(editor, range, n.id, n.title),
              }));
            // Sem correspondência exata + tem texto → oferece criar a nota.
            const exact = notes.some(
              (n) => n.title.toLowerCase() === q && q.length > 0,
            );
            if (q && !exact && options.onCreateNote) {
              matches.push({
                id: "__create__",
                title: `Criar nota “${query.trim()}”`,
                icon: "＋",
                run: (editor, range) => {
                  const wanted = query.trim();
                  void options.onCreateNote?.(wanted).then((created) => {
                    if (created) {
                      invalidateWikiCache();
                      insertLink(editor, range, created.id, wanted);
                    }
                  });
                },
              });
            }
            return matches;
          },
          command: ({ editor, range, props }) => props.run(editor, range),
          render: createSuggestionRenderer,
        }),
      ];
    },
  });
}
