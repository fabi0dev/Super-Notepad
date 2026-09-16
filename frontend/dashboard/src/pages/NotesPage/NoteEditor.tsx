import { useEffect, useRef, useState, type ReactNode } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import { Plugin, TextSelection } from "@tiptap/pm/state";
import { StarterKit } from "@tiptap/starter-kit";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { Table, TableRow, TableHeader, TableCell } from "@tiptap/extension-table";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import {
  NoteMedia,
  ImageLightbox,
  copyImageToClipboard,
} from "./NoteMediaNode";
import { Placeholder } from "@tiptap/extension-placeholder";
import { Typography } from "@tiptap/extension-typography";
import { Markdown } from "tiptap-markdown";
import { createLowlight, common } from "lowlight";
import {
  AlertTriangle,
  Bold,
  Check,
  ClipboardCopy,
  ClipboardPaste,
  Code,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  History,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  Maximize2,
  Minus,
  Paperclip,
  Quote,
  Redo2,
  RefreshCw,
  Scissors,
  Star,
  Strikethrough,
  Table as TableIcon,
  Undo2,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { platformShortcut } from "@/lib/shortcut";
import { Tooltip } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Modal,
  ModalBody,
  ModalHeader,
  ModalPanel,
  useModalEscape,
} from "@/components/ui/modal";
import {
  ContextMenu,
  type ContextMenuEntry,
} from "@/components/ui/context-menu";
import { slashCommand } from "./slashCommand";
import { wikiLink, NOTE_LINK_SCHEME } from "./wikiLink";
import { SublistShortcut } from "./sublistShortcut";
import { CharReveal } from "./charReveal";
import "./editor.css";

const lowlight = createLowlight(common);

/** O tiptap-markdown injeta este storage em runtime; o tipo não vem no pacote. */
function getMarkdown(editor: Editor): string {
  const storage = editor.storage as {
    markdown?: { getMarkdown?: () => string };
  };
  return storage.markdown?.getMarkdown?.() ?? "";
}

/** Envia um arquivo e insere no cursor: imagem vira ![](url); os demais viram
 *  um link [📎 nome](url). Em ambos os casos a referência fica no markdown, então
 *  sobrevive ao salvar e o Super Note (que lê markdown) enxerga o anexo. */
async function uploadAndInsert(editor: Editor, file: File): Promise<void> {
  const res = await api.notesUploadAttachment(file);
  if (res.kind === "image" || res.kind === "video") {
    // Vídeo entra no MESMO nó de imagem, marcado no alt (`nome|video`); o
    // NodeView o desenha como <video>. Assim salva/carrega como markdown normal.
    const alt = res.kind === "video" ? `${res.filename}|video` : res.filename;
    editor
      .chain()
      .focus()
      .setImage({ src: res.url, alt, title: res.filename })
      .run();
  } else {
    // Insere o link com o nome do arquivo + um espaço para o cursor sair da marca.
    editor
      .chain()
      .focus()
      .insertContent([
        {
          type: "text",
          text: `📎 ${res.filename}`,
          marks: [{ type: "link", attrs: { href: res.url } }],
        },
        { type: "text", text: " " },
      ])
      .run();
  }
}

/** Envia uma leva de arquivos em sequência, reportando o estado de "enviando". */
async function uploadFiles(
  editor: Editor | null,
  files: FileList | File[],
  onBusy: (busy: boolean) => void,
  onError: (msg: string) => void,
): Promise<void> {
  if (!editor) return;
  const list = Array.from(files);
  if (!list.length) return;
  onBusy(true);
  try {
    for (const file of list) {
      try {
        await uploadAndInsert(editor, file);
      } catch (e) {
        onError(e instanceof Error ? e.message : "Falha ao anexar o arquivo.");
      }
    }
  } finally {
    onBusy(false);
  }
}

/** Extrai arquivos "de verdade" de um evento de colar/soltar (ignora texto). */
function filesFromDataTransfer(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  const out: File[] = [];
  for (const item of Array.from(dt.files)) {
    if (item && item.size > 0) out.push(item);
  }
  return out;
}

export interface NoteEditorHandle {
  editor: Editor | null;
}

interface NoteEditorProps {
  /** Markdown inicial da nota. Trocar de nota re-hidrata o editor. */
  noteId: string;
  markdown: string;
  /** `noteId` é a nota a que o conteúdo pertence — o pai salva NESSA nota. */
  onChange: (markdown: string, noteId: string) => void;
  /** Clicou num vínculo para outra nota (esquema sn-note:<id>). */
  onOpenNote?: (id: string) => void;
  /** Criar nota a partir de um vínculo [[inexistente]]. */
  onCreateNote?: (title: string) => Promise<{ id: string } | null>;
  /** Estado de salvamento — vira um ícone de sync no fim da barra.
   *  "error" = a última gravação falhou (mostra alerta, não o check verde). */
  saveState?: "idle" | "saving" | "saved" | "error";
  /** Caminho de pastas até a nota ("Trabalho/Projetos") — breadcrumb no rodapé. */
  folderPath?: string;
  /** Abre a linha do tempo (histórico de versões). Ausente = rascunho, sem
   *  histórico ainda — o ícone no rodapé some. */
  onShowHistory?: () => void;
  /** Slot no fim da barra (após o check) — o menu "⋯" de ações da nota. */
  menuSlot?: ReactNode;
  /** Estado de favorito + toggle (estrela na barra). Ausente = sem estrela
   *  (ex.: aba-rascunho, que ainda não é uma nota de verdade). */
  favorite?: boolean;
  onToggleFavorite?: () => void;
}

// A 1ª linha é sempre um TÍTULO (H1). Em vez de restringir o schema do documento
// — o que rejeitaria/coagiria notas antigas que começam com parágrafo —, uma
// extensão promove o 1º bloco a heading nível 1 sempre que ele for um parágrafo.
// Assim: nota nova nasce com H1; nota antiga carrega intacta e a 1ª linha vira o
// título; blocos que não viram heading (lista, tabela, imagem) ficam como estão.
const FirstLineTitle = Extension.create({
  name: "firstLineTitle",
  // Enter no TÍTULO abre o CORPO em parágrafo — não herda o H1. O ProseMirror,
  // por padrão, ao quebrar um heading cria outro heading; aqui, quando o cursor
  // está no 1º bloco (o título), quebramos e transformamos a linha nova em
  // parágrafo. Fora do título, comportamento normal.
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { state } = this.editor;
        const { $from } = state.selection;
        const top = $from.node(1);
        if (
          $from.depth < 1 ||
          !top ||
          top.type.name !== "heading" ||
          $from.before(1) !== 0
        ) {
          return false;
        }
        // Cursor no FIM do título e já existe um parágrafo VAZIO logo abaixo
        // (a nota nova nasce assim: título + corpo vazio) → só move o cursor
        // pra ele. Sem isto, o splitBlock criava mais uma linha e o título
        // "saltava duas linhas".
        const atEnd = $from.parentOffset === top.content.size;
        const afterTitle = $from.after(1);
        const next = state.doc.nodeAt(afterTitle);
        if (
          atEnd &&
          next &&
          next.type.name === "paragraph" &&
          next.content.size === 0
        ) {
          return this.editor
            .chain()
            .setTextSelection(afterTitle + 1)
            .run();
        }
        // Caso geral (cursor no meio do título, ou fim com corpo NÃO-parágrafo
        // logo abaixo — ex.: checklist). Insere um parágrafo novo logo após o
        // título com o "tail" (texto após o cursor) e leva o cursor pra ele.
        //
        // ⚠️ NÃO usar `splitBlock().setNode("paragraph")`: o `setNode` chama
        // `clearNodes`, que ESTOURA com "Invalid content for node type
        // paragraph" quando o bloco seguinte é uma taskList/checklist — a
        // exceção abortava o Enter e a linha não quebrava (o bug do Fábio).
        return this.editor
          .chain()
          .command(({ tr, state, dispatch }) => {
            const { $from } = state.selection;
            const titleNode = $from.node(1);
            const tail = titleNode.textBetween(
              $from.parentOffset,
              titleNode.content.size,
            );
            const titleEnd = $from.after(1); // fecha o heading (antes do delete)
            if (tail) tr.delete($from.pos, $from.pos + tail.length);
            // Após apagar o tail, tudo à frente desloca `tail.length` à esquerda.
            const insertPos = titleEnd - tail.length;
            const paragraph = state.schema.nodes.paragraph;
            const node = paragraph.create(
              null,
              tail ? state.schema.text(tail) : null,
            );
            tr.insert(insertPos, node);
            tr.setSelection(TextSelection.create(tr.doc, insertPos + 1));
            if (dispatch) dispatch(tr);
            return true;
          })
          .run();
      },
    };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction: (_transactions, _oldState, newState) => {
          const first = newState.doc.firstChild;
          if (!first || first.type.name !== "paragraph") return null;
          const heading = newState.schema.nodes.heading;
          if (!heading) return null;
          const tr = newState.tr.setNodeMarkup(0, heading, { level: 1 });
          // Não vira um passo de desfazer próprio — é estrutura, não edição.
          tr.setMeta("addToHistory", false);
          return tr;
        },
      }),
    ];
  },
});

function buildExtensions(
  onCreateNote?: (title: string) => Promise<{ id: string } | null>,
) {
  return [
    FirstLineTitle,
    StarterKit.configure({
      // Usamos o bloco de código com realce (lowlight) no lugar do padrão.
      codeBlock: false,
      link: {
        openOnClick: false,
        autolink: true,
        // Permite o esquema interno dos vínculos entre notas.
        protocols: [NOTE_LINK_SCHEME],
        HTMLAttributes: { rel: "noopener noreferrer nofollow" },
      },
    }),
    CodeBlockLowlight.configure({ lowlight }),
    // Imagens anexadas: servidas por /api/notes/attachments/<id> e serializadas
    // como ![](url) pelo tiptap-markdown — o vínculo mora no próprio markdown.
    NoteMedia.configure({ inline: false, allowBase64: false }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    Typography,
    Placeholder.configure({
      placeholder: ({ node }) =>
        node.type.name === "heading"
          ? "Título"
          : "Escreva… ‘/’ para comandos, ‘[[’ para vincular uma nota.",
    }),
    Markdown.configure({
      html: false,
      transformPastedText: true,
      // Cópia PADRÃO (Cmd+C / "Copiar") = TEXTO PURO, não markdown. Copiar como
      // markdown fica no item dedicado "Copiar como .md" do menu de contexto.
      transformCopiedText: false,
      breaks: true,
    }),
    slashCommand,
    wikiLink({ onCreateNote }),
    SublistShortcut,
    CharReveal,
  ];
}

/** Um botão da barra de ferramentas. */
function TBtn({
  icon: Icon,
  label,
  shortcut,
  active,
  disabled,
  onClick,
}: {
  icon: typeof Bold;
  label: string;
  /** Atalho exibido no tooltip (ex.: "⌘B"). */
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip
      content={shortcut ? `${label} · ${platformShortcut(shortcut)}` : label}
    >
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors",
          "text-muted-foreground hover:bg-(--surface-hover) hover:text-foreground",
          "disabled:opacity-40 disabled:hover:bg-transparent",
          active && "bg-(--primary-muted) text-primary hover:bg-(--primary-muted)",
        )}
      >
        <Icon className="h-4 w-4" />
      </button>
    </Tooltip>
  );
}

function Toolbar({
  editor,
  saveState,
  menuSlot,
  favorite,
  onToggleFavorite,
  uploading,
  onUpload,
}: {
  editor: Editor;
  saveState?: "idle" | "saving" | "saved" | "error";
  menuSlot?: ReactNode;
  favorite?: boolean;
  onToggleFavorite?: () => void;
  uploading?: boolean;
  onUpload?: (files: FileList) => void;
}) {
  // Assinar as mudanças para o estado ativo dos botões reagir ao cursor.
  const sep = <span className="mx-1 h-5 w-px bg-(--divider)" aria-hidden />;

  // Input de arquivo escondido — o clipe da barra dispara o seletor do sistema.
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Inserir link por diálogo controlado — `window.prompt` não abre no app
  // desktop (WKWebView), então o botão de link ficava morto lá.
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const openLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    setLinkUrl(prev ?? "https://");
    setLinkOpen(true);
  };
  const closeLink = () => setLinkOpen(false);
  useModalEscape(closeLink, linkOpen);
  const applyLink = () => {
    const url = linkUrl.trim();
    if (!url) {
      editor.chain().focus().unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    }
    setLinkOpen(false);
  };
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-solid border-(--divider) px-2 py-1.5">
      <TBtn
        icon={Undo2}
        label="Desfazer"
        shortcut="⌘Z"
        disabled={!editor.can().undo()}
        onClick={() => editor.chain().focus().undo().run()}
      />
      <TBtn
        icon={Redo2}
        label="Refazer"
        shortcut="⌘⇧Z"
        disabled={!editor.can().redo()}
        onClick={() => editor.chain().focus().redo().run()}
      />
      {sep}
      <TBtn
        icon={Heading1}
        label="Título 1"
        shortcut="⌘⌥1"
        active={editor.isActive("heading", { level: 1 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      />
      <TBtn
        icon={Heading2}
        label="Título 2"
        shortcut="⌘⌥2"
        active={editor.isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      />
      <TBtn
        icon={Heading3}
        label="Título 3"
        shortcut="⌘⌥3"
        active={editor.isActive("heading", { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      />
      {sep}
      <TBtn
        icon={Bold}
        label="Negrito"
        shortcut="⌘B"
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      />
      <TBtn
        icon={Italic}
        label="Itálico"
        shortcut="⌘I"
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      />
      <TBtn
        icon={Strikethrough}
        label="Tachado"
        shortcut="⌘⇧S"
        active={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      />
      <TBtn
        icon={Code}
        label="Código"
        shortcut="⌘E"
        active={editor.isActive("code")}
        onClick={() => editor.chain().focus().toggleCode().run()}
      />
      <TBtn
        icon={LinkIcon}
        label="Link"
        active={editor.isActive("link")}
        onClick={openLink}
      />
      {sep}
      <TBtn
        icon={List}
        label="Lista"
        shortcut="⌘⇧8"
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      />
      <TBtn
        icon={ListOrdered}
        label="Lista numerada"
        shortcut="⌘⇧7"
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      />
      <TBtn
        icon={ListChecks}
        label="Checklist"
        shortcut="⌘⇧9"
        active={editor.isActive("taskList")}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
      />
      <TBtn
        icon={Quote}
        label="Citação"
        shortcut="⌘⇧B"
        active={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      />
      <TBtn
        icon={Code2}
        label="Bloco de código"
        shortcut="⌘⌥C"
        active={editor.isActive("codeBlock")}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      />
      <TBtn
        icon={TableIcon}
        label="Tabela"
        onClick={() =>
          editor
            .chain()
            .focus()
            .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
            .run()
        }
      />
      <TBtn
        icon={Minus}
        label="Divisória"
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
      />
      {sep}
      <TBtn
        icon={Paperclip}
        label={uploading ? "Enviando…" : "Anexar arquivo ou imagem"}
        disabled={uploading}
        onClick={() => fileInputRef.current?.click()}
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) onUpload?.(e.target.files);
          // Zera para permitir reenviar o mesmo arquivo em seguida.
          e.target.value = "";
        }}
      />

      {/* Status de sincronização no fim da barra, após a divisória. */}
      <div className="ml-auto flex items-center gap-1 pl-1">
        {onToggleFavorite ? (
          <Tooltip content={favorite ? "Desfavoritar" : "Favoritar"}>
            <button
              type="button"
              onClick={onToggleFavorite}
              aria-label={favorite ? "Desfavoritar" : "Favoritar"}
              aria-pressed={!!favorite}
              className={cn(
                "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-(--surface-hover)",
                favorite ? "text-amber-400" : "text-muted-foreground",
              )}
            >
              <Star className={cn("h-4 w-4", favorite && "fill-amber-400")} />
            </button>
          </Tooltip>
        ) : null}
        {sep}
        <Tooltip
          content={
            saveState === "saving"
              ? "Salvando…"
              : saveState === "error"
                ? "Não foi possível salvar — tento de novo ao editar"
                : "Salvo"
          }
        >
          <span
            aria-label={
              saveState === "saving"
                ? "Salvando"
                : saveState === "error"
                  ? "Não salvo"
                  : "Salvo"
            }
            className="inline-flex h-8 w-8 items-center justify-center text-muted-foreground"
          >
            {saveState === "saving" ? (
              <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground/70" />
            ) : saveState === "error" ? (
              <AlertTriangle className="h-4 w-4 text-amber-500" />
            ) : (
              <Check className="h-4 w-4 text-primary" />
            )}
          </span>
        </Tooltip>
        {menuSlot}
      </div>

      {/* Diálogo de link — substitui window.prompt (morto no WKWebView). */}
      <Modal open={linkOpen} onBackdropClick={closeLink} align="center">
        <ModalPanel labelledBy="note-link-title" className="w-full max-w-sm">
          <ModalHeader
            titleId="note-link-title"
            title="Inserir link"
            subtitle="Cole o endereço. Deixe em branco para remover o link."
            onClose={closeLink}
          />
          <ModalBody className="space-y-3 pt-4">
            <Input
              autoFocus
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyLink();
                }
              }}
              placeholder="https://…"
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={closeLink}>
                Cancelar
              </Button>
              <Button variant="brand" size="sm" onClick={applyLink}>
                {linkUrl.trim() ? "Aplicar" : "Remover link"}
              </Button>
            </div>
          </ModalBody>
        </ModalPanel>
      </Modal>
    </div>
  );
}

export function NoteEditor({
  noteId,
  markdown,
  onChange,
  onOpenNote,
  onCreateNote,
  saveState,
  menuSlot,
  favorite,
  onToggleFavorite,
  folderPath,
  onShowHistory,
}: NoteEditorProps) {
  // Estado dos anexos: "enviando" (spinner no clipe) e erro pontual (banner).
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  // Há seleção de texto AGORA? O TipTap v3 não re-renderiza a cada mudança de
  // seleção, então ler `editor.state.selection.empty` direto no render fica
  // STALE — o menu de contexto abria com Recortar/Copiar/etc. desabilitados
  // mesmo com texto selecionado. Rastreamos via evento pra ficar fresco.
  const [hasSel, setHasSel] = useState(false);
  // Alvo do botão-direito quando é uma imagem: troca o menu de texto por ações
  // de imagem (copiar/visualizar). `viewerSrc` abre o lightbox pela ação.
  const [imgCtxSrc, setImgCtxSrc] = useState<string | null>(null);
  const [viewerSrc, setViewerSrc] = useState<string | null>(null);
  // Ref para os handlers de colar/soltar alcançarem o editor sem forward-ref.
  const editorRef = useRef<Editor | null>(null);
  // Qual nota o conteúdo atual do editor representa. O onUpdate só salva quando
  // isto bate com o noteId — trava anti-corrupção ao trocar de nota (o setContent
  // abaixo é quem confirma o sync).
  const syncedNoteIdRef = useRef<string | null>(null);

  const editor = useEditor(
    {
      extensions: buildExtensions(onCreateNote),
      content: markdown,
      editorProps: {
        attributes: {
          class: "min-h-[60vh] px-6 pb-5 pt-3 focus:outline-none",
          // Correção ortográfica nativa do sistema (sublinhado nas palavras
          // erradas). `lang` orienta o dicionário; pt-BR por padrão.
          spellcheck: "true",
          lang: "pt-BR",
          autocorrect: "on",
          autocapitalize: "sentences",
        },
        // Abrir link só com Cmd/Ctrl+clique — o clique simples posiciona o cursor
        // para editar o texto do link (padrão de editores: VS Code, Notion). Com
        // o modificador: vínculo de nota abre a nota aqui mesmo; link externo
        // (http/mailto) abre fora, como no resto do app. `openOnClick` fica false
        // (a extensão Link não navega sozinha dentro do editable), então o clique
        // é tratado aqui.
        handleClickOn: (_view, _pos, _node, _nodePos, event) => {
          // metaKey = ⌘ no macOS; ctrlKey = Ctrl no Windows/Linux.
          if (!(event.metaKey || event.ctrlKey)) return false;
          const anchor = (event.target as HTMLElement)?.closest?.("a[href]");
          const href = anchor?.getAttribute("href") ?? "";
          if (!href) return false;
          if (href.startsWith(`${NOTE_LINK_SCHEME}:`)) {
            event.preventDefault();
            const id = href.slice(NOTE_LINK_SCHEME.length + 1);
            if (id) onOpenNote?.(id);
            return true;
          }
          if (/^(https?:|mailto:)/i.test(href)) {
            event.preventDefault();
            window.open(href, "_blank", "noopener,noreferrer");
            return true;
          }
          return false;
        },
        // Colar imagem/arquivo (ex.: print da tela) → sobe e insere no cursor.
        handlePaste: (_view, event) => {
          const files = filesFromDataTransfer(event.clipboardData);
          if (!files.length) return false;
          event.preventDefault();
          void uploadFiles(editorRef.current, files, setUploading, setUploadError);
          return true;
        },
        // Arrastar-soltar arquivos no editor → insere no ponto do drop.
        handleDrop: (view, event) => {
          const dragEvent = event as DragEvent;
          const files = filesFromDataTransfer(dragEvent.dataTransfer);
          if (!files.length) return false;
          event.preventDefault();
          const pos = view.posAtCoords({
            left: dragEvent.clientX,
            top: dragEvent.clientY,
          });
          if (pos && editorRef.current) {
            editorRef.current.commands.setTextSelection(pos.pos);
          }
          void uploadFiles(editorRef.current, files, setUploading, setUploadError);
          return true;
        },
      },
      onUpdate: ({ editor }) => {
        // TRAVA ANTI-CORRUPÇÃO 1: só salva depois que o conteúdo desta nota foi
        // sincronizado (evita gravar conteúdo transitório durante a montagem).
        if (syncedNoteIdRef.current !== noteId) return;
        // TRAVA ANTI-CORRUPÇÃO 2 (a raiz): manda SEMPRE o `noteId` DESTE editor
        // junto. O pai salva nessa nota — nunca no `selectedId` atual. Sem isto,
        // ao clicar rápido A→B, o onChange da NoteEditor de A era religado ao B
        // e o conteúdo de A ia parar no id de B (era o que corrompia tudo).
        onChange(getMarkdown(editor), noteId);
      },
    },
    // Recria o editor ao trocar de nota — o modo mais confiável de re-hidratar
    // sem arrastar histórico de undo de uma nota para outra.
    [noteId],
  );
  editorRef.current = editor;

  // Garante que o conteúdo bata com a nota mesmo quando o markdown chega depois
  // da montagem (fetch assíncrono) OU quando muda por fora (renomear edita a 1ª
  // linha). Seguro contra digitação: `markdown` (current.content no pai) só muda
  // ao carregar/renomear, não a cada tecla; e o guard evita reescrever se já bate.
  useEffect(() => {
    if (!editor) return;
    const current = getMarkdown(editor);
    if (current.trim() !== (markdown ?? "").trim()) {
      editor.commands.setContent(markdown ?? "", { emitUpdate: false });
    }
    // O conteúdo agora É o desta nota → libera o save (trava no onUpdate).
    syncedNoteIdRef.current = noteId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, noteId, markdown]);

  // A 1ª linha é o TÍTULO (heading) desde a abertura — e o cursor nasce NELE.
  // O `appendTransaction` força heading nas EDIÇÕES, mas não no doc inicial
  // vazio: sem isto a nota nova abria como parágrafo ("Escreva…"), o cursor caía
  // no corpo, e o Enter no "título" (que ainda era parágrafo) jogava o texto pra
  // baixo. Roda ao abrir cada nota.
  useEffect(() => {
    if (!editor) return;
    const doc = editor.state.doc;
    const first = doc.firstChild;
    if (first && first.type.name === "paragraph") {
      // Fixup ESTRUTURAL (não é edição do usuário): suprime o save enquanto
      // roda, senão o onUpdate gravaria isto — e num troca-troca de notas
      // acabava salvando conteúdo no id errado (corrompeu notas). O save só
      // volta quando o usuário digita de verdade.
      const prevSynced = syncedNoteIdRef.current;
      syncedNoteIdRef.current = null;
      try {
        editor
          .chain()
          .command(({ tr, state }) => {
            tr.setNodeMarkup(0, state.schema.nodes.heading, { level: 1 });
            tr.setMeta("addToHistory", false);
            return true;
          })
          .run();
      } finally {
        syncedNoteIdRef.current = prevSynced;
      }
    }
    // Cursor na 1ª linha (título) só quando a nota está vazia — não mexe no
    // ponto de edição de uma nota que já tem conteúdo.
    if (doc.childCount === 1 && (doc.firstChild?.content.size ?? 0) === 0) {
      editor.commands.focus("start");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, noteId]);

  // Contagem de palavras/caracteres, reativa às edições (inclusive as do
  // agente, que também disparam "update" ao re-hidratar o conteúdo).
  const [counts, setCounts] = useState({ words: 0, chars: 0 });
  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const text = editor.getText();
      const trimmed = text.trim();
      setCounts({
        words: trimmed ? trimmed.split(/\s+/).length : 0,
        chars: text.length,
      });
    };
    update();
    editor.on("update", update);
    return () => {
      editor.off("update", update);
    };
  }, [editor]);

  // Seleção fresca: re-renderiza quando ela muda, pro menu/bolha refletirem.
  useEffect(() => {
    if (!editor) return;
    const update = () => setHasSel(!editor.state.selection.empty);
    update();
    editor.on("selectionUpdate", update);
    return () => {
      editor.off("selectionUpdate", update);
    };
  }, [editor]);

  if (!editor) return null;

  // Menu de contexto próprio (em português) no lugar do nativo do sistema, que
  // aparecia em inglês (Cut/Copy/Look Up…). Recortar/Copiar via execCommand
  // (gesto do usuário), Colar via clipboard API; e a formatação da seleção.
  const hasSelection = hasSel;
  const editorMenu: ContextMenuEntry[] = [
    {
      label: "Recortar",
      icon: Scissors,
      disabled: !hasSelection,
      onSelect: () => document.execCommand("cut"),
    },
    {
      label: "Copiar",
      icon: ClipboardCopy,
      disabled: !hasSelection,
      onSelect: () => document.execCommand("copy"),
    },
    {
      label: "Copiar como .md",
      icon: Code2,
      disabled: !hasSelection,
      onSelect: () => {
        // Serializa SÓ a seleção para markdown (o serializer do tiptap-markdown).
        try {
          const storage = editor.storage as {
            markdown?: { serializer?: { serialize: (c: unknown) => string } };
          };
          const slice = editor.state.selection.content();
          const md = (
            storage.markdown?.serializer?.serialize(slice.content) ?? ""
          ).trim();
          if (md) void navigator.clipboard?.writeText(md).catch(() => {});
        } catch {
          /* sem serializer: silencioso (a cópia normal continua funcionando) */
        }
      },
    },
    {
      label: "Colar",
      icon: ClipboardPaste,
      onSelect: () => {
        navigator.clipboard
          ?.readText()
          .then((text) => editor.chain().focus().insertContent(text).run())
          .catch(() => {});
      },
    },
    "separator",
    {
      label: "Negrito",
      icon: Bold,
      onSelect: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: "Itálico",
      icon: Italic,
      onSelect: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: "Código",
      icon: Code,
      onSelect: () => editor.chain().focus().toggleCode().run(),
    },
  ];

  // Botão-direito EM CIMA de uma imagem: o menu de texto (Recortar/Copiar como
  // .md/…) não servia e o "Copiar" copiava o markdown, não a imagem. Aqui as
  // ações são de imagem de fato.
  const imageMenu: ContextMenuEntry[] = imgCtxSrc
    ? [
        {
          label: "Copiar imagem",
          icon: ClipboardCopy,
          onSelect: () => {
            void copyImageToClipboard(imgCtxSrc);
          },
        },
        {
          label: "Visualizar",
          icon: Maximize2,
          onSelect: () => setViewerSrc(imgCtxSrc),
        },
      ]
    : [];
  const menuItems = imgCtxSrc ? imageMenu : editorMenu;

  return (
    <div className="note-editor flex min-h-0 flex-1 flex-col">
      <Toolbar
        editor={editor}
        saveState={saveState}
        menuSlot={menuSlot}
        favorite={favorite}
        onToggleFavorite={onToggleFavorite}
        uploading={uploading}
        onUpload={(files) =>
          uploadFiles(editor, files, setUploading, setUploadError)
        }
      />
      {uploadError ? (
        <div className="mx-3 mt-2 flex items-center justify-between gap-3 rounded-lg border border-solid border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-300">
          <span className="inline-flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {uploadError}
          </span>
          <button
            type="button"
            onClick={() => setUploadError("")}
            className="shrink-0 rounded px-1.5 py-0.5 hover:bg-amber-500/15"
          >
            Fechar
          </button>
        </div>
      ) : null}
      <ContextMenu items={menuItems}>
        {/* Folha da escrita: fundo ESCURO (--background) — o escuro fica só
            aqui, onde se escreve. Cantos arredondados e margem em volta
            (inclusive embaixo, para descolar do fundo) — flutua sobre a moldura
            clara (a section e a barra usam --surface). Sem borda, sem sombra.
            Com "Fundo transparente" ligado a folha CEDE (index.css): sem uma 2ª
            camada de --background empilhada sobre a do shell, a área de escrita
            não escurece em dobro nem tapa o papel de parede. */}
        <div
          className="note-sheet ui-scrollbar mx-3 mb-3 mt-2 min-h-0 flex-1 overflow-y-auto rounded-xl bg-background"
          onContextMenuCapture={(e) => {
            // Roda ANTES do ContextMenu abrir (mesmo evento), então `menuItems`
            // já reflete o alvo no render que mostra o menu.
            const el = (e.target as HTMLElement)?.closest?.(".note-media-el");
            setImgCtxSrc(
              el && el.tagName === "IMG"
                ? (el as HTMLImageElement).src
                : null,
            );
          }}
        >
          <EditorContent editor={editor} />
        </div>
      </ContextMenu>
      {viewerSrc ? (
        <ImageLightbox
          src={viewerSrc}
          alt=""
          onClose={() => setViewerSrc(null)}
        />
      ) : null}
      {/* Rodapé: linha do tempo (ícone) + contagem + CAMINHO das pastas. */}
      <div className="flex shrink-0 items-center gap-2 px-4 pb-1.5 text-[11px] text-muted-foreground/70">
        {onShowHistory ? (
          <Tooltip content="Linha do tempo">
            <button
              type="button"
              onClick={onShowHistory}
              aria-label="Linha do tempo da nota"
              className="-my-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-(--surface-hover) hover:text-foreground"
            >
              <History className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        ) : null}
        <span className="shrink-0 tabular-nums">
          {counts.words} {counts.words === 1 ? "palavra" : "palavras"} ·{" "}
          {counts.chars} {counts.chars === 1 ? "caractere" : "caracteres"}
        </span>
        {folderPath ? (
          <>
            <span aria-hidden className="shrink-0 text-muted-foreground/35">
              ·
            </span>
            <span className="flex min-w-0 items-center gap-1 truncate">
              {folderPath.split("/").map((seg, i, arr) => (
                <span key={i} className="flex shrink-0 items-center gap-1">
                  {i > 0 ? (
                    <span aria-hidden className="text-muted-foreground/35">
                      ›
                    </span>
                  ) : null}
                  <span className={i === arr.length - 1 ? "text-muted-foreground" : ""}>
                    {seg}
                  </span>
                </span>
              ))}
            </span>
          </>
        ) : null}
      </div>
    </div>
  );
}
