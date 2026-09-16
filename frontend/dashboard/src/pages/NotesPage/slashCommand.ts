import { Extension, type Editor, type Range } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion from "@tiptap/suggestion";
import { createSuggestionRenderer, type SuggestItem } from "./suggestionRenderer";

/** Apaga o "/consulta" digitado antes de inserir o bloco. */
function replace(editor: Editor, range: Range) {
  return editor.chain().focus().deleteRange(range);
}

const COMMANDS: Array<Omit<SuggestItem, "run"> & {
  keywords: string;
  run: (editor: Editor, range: Range) => void;
}> = [
  {
    id: "h1",
    title: "Título 1",
    icon: "H₁",
    keywords: "titulo heading h1 cabecalho",
    run: (e, r) => replace(e, r).toggleHeading({ level: 1 }).run(),
  },
  {
    id: "h2",
    title: "Título 2",
    icon: "H₂",
    keywords: "titulo heading h2",
    run: (e, r) => replace(e, r).toggleHeading({ level: 2 }).run(),
  },
  {
    id: "h3",
    title: "Título 3",
    icon: "H₃",
    keywords: "titulo heading h3",
    run: (e, r) => replace(e, r).toggleHeading({ level: 3 }).run(),
  },
  {
    id: "bullet",
    title: "Lista",
    icon: "•",
    keywords: "lista bullet ul",
    run: (e, r) => replace(e, r).toggleBulletList().run(),
  },
  {
    id: "ordered",
    title: "Lista numerada",
    icon: "1.",
    keywords: "lista numerada ordered ol",
    run: (e, r) => replace(e, r).toggleOrderedList().run(),
  },
  {
    id: "task",
    title: "Checklist",
    icon: "☑",
    keywords: "checklist tarefa todo caixa",
    run: (e, r) => replace(e, r).toggleTaskList().run(),
  },
  {
    id: "quote",
    title: "Citação",
    icon: "❝",
    keywords: "citacao quote blockquote",
    run: (e, r) => replace(e, r).toggleBlockquote().run(),
  },
  {
    id: "code",
    title: "Bloco de código",
    icon: "‹›",
    keywords: "codigo code bloco pre",
    run: (e, r) => replace(e, r).toggleCodeBlock().run(),
  },
  {
    id: "table",
    title: "Tabela",
    icon: "▦",
    keywords: "tabela table grade",
    run: (e, r) =>
      replace(e, r)
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run(),
  },
  {
    id: "hr",
    title: "Divisória",
    icon: "―",
    keywords: "divisoria linha separador hr",
    run: (e, r) => replace(e, r).setHorizontalRule().run(),
  },
];

export const slashCommand = Extension.create({
  name: "slashCommand",
  addProseMirrorPlugins() {
    return [
      Suggestion<SuggestItem>({
        editor: this.editor,
        pluginKey: new PluginKey("slashCommand"),
        char: "/",
        startOfLine: false,
        // Só dispara quando "/" abre um bloco/linha em branco ou após espaço —
        // evita atrapalhar quem digita "/" no meio de uma URL ou caminho.
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          const before = $from.nodeBefore?.text ?? "";
          return before === "" || /\s$/.test(before);
        },
        command: ({ editor, range, props }) => props.run(editor, range),
        items: ({ query }) => {
          const q = query.toLowerCase().trim();
          const list = COMMANDS.filter(
            (c) =>
              !q ||
              c.title.toLowerCase().includes(q) ||
              c.keywords.includes(q),
          );
          return list.map((c) => ({
            id: c.id,
            title: c.title,
            icon: c.icon,
            run: c.run,
          }));
        },
        render: createSuggestionRenderer,
      }),
    ];
  },
});
