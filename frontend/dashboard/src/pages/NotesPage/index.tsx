import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import {
  ArrowDownAZ,
  ArrowDownWideNarrow,
  ChevronRight,
  Copy,
  Download,
  FilePlus2,
  FileText,
  FolderPlus,
  Link2,
  NotebookPen,
  PanelLeft,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { api, type Note, type NoteSummary } from "@/lib/api";
import { cn, isoTimeAgo } from "@/lib/utils";
import { platformShortcut } from "@/lib/shortcut";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { ContextMenu, type ContextMenuEntry } from "@/components/ui/context-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Toast } from "@/components/Toast";
import { useToast } from "@/hooks/useToast";
import { NoteEditor } from "./NoteEditor";
import { NoteHistoryModal } from "./NoteHistoryModal";
import { invalidateWikiCache } from "./wikiLink";
import { buildFolderTree, type FolderNode } from "./folderTree";
import {
  DRAFT_ID,
  draftLabelFromMarkdown,
  loadOpenTabs,
  loadSelected,
  safeFileName,
  saveOpenTabs,
  saveSelected,
  singleFolderSegment,
  withRenamedFirstLine,
  type SaveState,
} from "./notesShared";
import { InlineNameInput } from "./components/InlineNameInput";
import { NoteMoreMenu } from "./components/NoteMoreMenu";
import { NoteTabsBar } from "./components/NoteTabsBar";
import { useSidebarResize } from "./hooks/useSidebarResize";
import { useNoteDrag } from "./hooks/useNoteDrag";

export default function NotesPage() {
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Abas abertas (ids de nota, na ordem). A ativa é a `selectedId`. Abrir uma
  // nota a foca (adicionando uma aba se ainda não estiver aberta). Pode conter
  // DRAFT_ID (aba-rascunho, sem nota real até digitar).
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  // Só persistimos DEPOIS que a restauração inicial rodou — senão o efeito de
  // save dispararia na montagem com `openTabs=[]` e apagaria o estado salvo
  // antes de a restauração (assíncrona) conseguir lê-lo.
  const hydratedRef = useRef(false);
  // Rascunho: id da nota criada por trás quando o usuário digita (null até lá) +
  // rótulo da aba. O selo prevSel detecta a saída da aba-rascunho para finalizá-la.
  const draftRealId = useRef<string | null>(null);
  // Pasta onde a nota-rascunho vai nascer — capturada ao ABRIR o rascunho (a
  // pasta da nota que estava focada então). No flush, o `current` já é o próprio
  // rascunho (pasta ""), então precisa vir daqui.
  const draftFolderRef = useRef("");
  const [draftTitle, setDraftTitle] = useState("");
  const prevSelRef = useRef<string | null>(null);
  const [current, setCurrent] = useState<Note | null>(null);
  const [query, setQuery] = useState("");
  // A busca fica oculta por padrão; a lupa em headerActions a revela.
  const [searchOpen, setSearchOpen] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const { toast, showToast } = useToast();
  // Pastas EXPANDIDAS (vazio = todas fechadas: as pastas começam recolhidas).
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // Largura da lista (redimensionável arrastando a borda direita). Persistida.
  const {
    sidebarWidth,
    setSidebarWidth,
    resizing,
    onResizeStart,
    onResizeMove,
    onResizeEnd,
  } = useSidebarResize();
  const [historyOpen, setHistoryOpen] = useState(false);
  // No app desktop, o botão de ocultar lista vai para a faixa da janela (ao
  // lado das bolinhas); no navegador fica no cabeçalho da página.
  const [titlebarSlot, setTitlebarSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const isDesktop =
      document.documentElement.classList.contains("sn-desktop");
    setTitlebarSlot(
      isDesktop ? document.getElementById("sn-titlebar-slot-left") : null,
    );
  }, []);
  // Criação inline de pasta (estilo Docmost): onde estamos criando
  // (null = não; "" = raiz; caminho = subpasta). Um campo aparece na árvore.
  const [creatingIn, setCreatingIn] = useState<string | null>(null);
  // Renomear pasta / nota inline (campo pré-preenchido).
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renamingNoteId, setRenamingNoteId] = useState<string | null>(null);
  // Confirmação de exclusão (o window.confirm não funciona no WKWebView).
  const [confirmDel, setConfirmDel] = useState<{
    title: string;
    description: string;
    run: () => void;
    /** Rótulo do botão de confirmar (default "Apagar"). */
    confirmLabel?: string;
    /** Ação destrutiva = botão vermelho (default true; apagar). */
    destructive?: boolean;
  } | null>(null);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<{ id: string; content: string } | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // Abas que o usuário EDITOU nesta sessão. Uma aba suja não é substituída ao
  // abrir outra nota — a nova entra em aba nova (preserva o trabalho em curso).
  // Limpa quando a aba fecha. Ref (não estado): lida no clique, sem re-render.
  const dirtyTabsRef = useRef<Set<string>>(new Set());
  // Assinatura da última lista aplicada — o poll de tempo real só re-renderiza
  // a sidebar quando algo MUDA de fato (senão a cada 4s a árvore re-montaria e
  // atrapalharia cliques/expansão).
  const listSigRef = useRef<string>("");

  const refreshList = useCallback(async () => {
    try {
      const { notes, folders } = await api.notesList();
      // Só aplica no estado se mudou — evita re-render da sidebar a cada poll.
      const sig =
        notes
          .map((n) =>
            [n.id, n.title, n.updated, n.folder, n.locked, n.favorite].join("~"),
          )
          .join("|") +
        "§" +
        folders.join(",");
      if (sig !== listSigRef.current) {
        listSigRef.current = sig;
        setNotes(notes);
        setFolders(folders);
      }
      return { notes, folders };
    } catch {
      return { notes: [] as NoteSummary[], folders: [] as string[] };
    }
  }, []);

  const [searchParams, setSearchParams] = useSearchParams();
  const openParam = searchParams.get("open");
  const newParam = searchParams.get("new");

  useEffect(() => {
    let alive = true;
    void (async () => {
      const { notes } = await refreshList();
      if (alive) {
        setLoading(false);
        const exists = (id: string) => notes.some((n) => n.id === id);
        // Restaura EXATAMENTE as abas que o usuário deixou (só as que ainda
        // existem). Nada de abrir nota sozinho: se ele fechou tudo, a área fica
        // no estado vazio ("Escolha uma nota"). Só o deeplink ?open= (ex.: o
        // Super Note abrindo uma nota) força uma nota a entrar.
        const deeplink = openParam && exists(openParam) ? openParam : null;
        let tabs = (loadOpenTabs() ?? []).filter(exists);
        if (deeplink && !tabs.includes(deeplink)) tabs = [...tabs, deeplink];
        const storedSel = loadSelected();
        const sel =
          deeplink ??
          (storedSel && tabs.includes(storedSel) ? storedSel : tabs[0] ?? null);
        setSelectedId(sel);
        setOpenTabs(tabs);
        // Persiste o estado restaurado e libera os saves subsequentes.
        saveOpenTabs(tabs);
        saveSelected(sel);
        hydratedRef.current = true;
      }
    })();
    return () => {
      alive = false;
    };
  }, [refreshList, openParam]);

  // Persiste abas + seleção — é o que faz fechar uma aba "colar" ao voltar.
  // Guardado por hydratedRef: não salva antes da restauração inicial (senão
  // apagaria o estado salvo na montagem).
  useEffect(() => {
    if (hydratedRef.current) saveOpenTabs(openTabs);
  }, [openTabs]);
  useEffect(() => {
    if (hydratedRef.current) saveSelected(selectedId);
  }, [selectedId]);

  // Tempo real: notas criadas/alteradas pelo agente (ou em outra janela)
  // aparecem na lista sem reabrir o app. Poll leve (só metadados) enquanto a
  // janela está visível + refresh imediato ao focar/voltar. `refreshList` só
  // atualiza lista/pastas — NÃO toca no editor —, então é seguro ao editar.
  useEffect(() => {
    const tick = () => {
      if (hydratedRef.current && document.visibilityState === "visible")
        void refreshList();
    };
    const id = window.setInterval(tick, 4000);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [refreshList]);

  const flush = useCallback(async () => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    // Aba-rascunho: só CRIA a nota quando há conteúdo; enquanto vazia, não gera
    // "Sem título" nenhum. Depois de criada, edições vão para draftRealId.
    if (p.id === DRAFT_ID) {
      if (!p.content.trim()) {
        setSaveState("idle");
        return;
      }
      try {
        if (draftRealId.current) {
          const updated = await api.notesUpdate(draftRealId.current, {
            content: p.content,
          });
          invalidateWikiCache();
          setNotes((prev) =>
            prev.map((n) =>
              n.id === updated.id
                ? { ...n, title: updated.title, snippet: updated.snippet, updated: updated.updated }
                : n,
            ),
          );
        } else {
          const note = await api.notesCreate(
            "",
            p.content,
            draftFolderRef.current || "",
          );
          draftRealId.current = note.id;
          invalidateWikiCache();
          await refreshList();
        }
        setSaveState("saved");
      } catch {
        // Falha real de gravação: NÃO mostrar "Salvo". O indicador de erro
        // avisa; a próxima edição re-dispara o autosave.
        setSaveState("error");
      }
      return;
    }
    try {
      const updated = await api.notesUpdate(p.id, { content: p.content });
      invalidateWikiCache();
      setNotes((prev) =>
        prev.map((n) =>
          n.id === updated.id
            ? { ...n, title: updated.title, snippet: updated.snippet, updated: updated.updated }
            : n,
        ),
      );
      // Atualiza também a nota aberta para o título/breadcrumb acompanhar sem
      // precisar reabrir. NÃO toca no content (o usuário está digitando).
      setCurrent((c) =>
        c && c.id === updated.id
          ? { ...c, title: updated.title, updated: updated.updated }
          : c,
      );
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }, [refreshList]);

  useEffect(() => {
    const prev = prevSelRef.current;
    prevSelRef.current = selectedId;
    if (!selectedId) {
      setCurrent(null);
      return;
    }
    let alive = true;
    void (async () => {
      // Salva o pendente ao trocar de aba (o rascunho materializa a nota aqui).
      if (pending.current) {
        clearTimeout(saveTimer.current);
        await flush();
      }
      // Saiu da aba-rascunho: se virou nota (draftRealId), a aba passa a apontar
      // para a nota real; se nada foi digitado, a aba some (nenhuma nota criada).
      if (prev === DRAFT_ID && selectedId !== DRAFT_ID) {
        const realId = draftRealId.current;
        draftRealId.current = null;
        if (alive) setDraftTitle("");
        // Herda o estado "sujo" do rascunho para a nota real recém-criada.
        if (dirtyTabsRef.current.delete(DRAFT_ID) && realId)
          dirtyTabsRef.current.add(realId);
        setOpenTabs((tabs) =>
          realId
            ? tabs.map((t) => (t === DRAFT_ID ? realId : t))
            : tabs.filter((t) => t !== DRAFT_ID),
        );
      }
      if (selectedId === DRAFT_ID) {
        // Rascunho: nota sintética vazia, nada a buscar.
        if (alive)
          setCurrent({
            id: DRAFT_ID,
            title: "",
            content: "",
            folder: "",
            snippet: "",
            created: "",
            updated: "",
          });
        return;
      }
      try {
        const note = await api.notesGet(selectedId);
        if (alive) setCurrent(note);
      } catch {
        if (alive) setCurrent(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [selectedId, flush]);

  useEffect(
    () => () => {
      clearTimeout(saveTimer.current);
      void flush();
    },
    [flush],
  );

  const onEditorChange = useCallback(
    (markdown: string, fromNoteId: string) => {
      // Salva na nota a que o conteúdo PERTENCE (fromNoteId), nunca no
      // `selectedId` atual — que já pode ter mudado num clique rápido. Foi essa
      // troca (selectedId em vez da nota de origem) que corrompia as notas.
      if (!fromNoteId) return;
      // Editou → marca a aba como suja (não será substituída ao abrir outra).
      dirtyTabsRef.current.add(fromNoteId);
      // Na aba-rascunho, o rótulo acompanha a 1ª linha enquanto se digita.
      if (fromNoteId === DRAFT_ID)
        setDraftTitle(draftLabelFromMarkdown(markdown));
      pending.current = { id: fromNoteId, content: markdown };
      setSaveState("saving");
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void flush(), 800);
    },
    [flush],
  );

  // "Pasta focada" = a pasta da nota aberta agora. Nota nova genérica ("Nova
  // nota", ⌘N, "+") nasce AÍ, não na raiz — se você está trabalhando dentro de
  // "Trabalho", a próxima nota vai pra "Trabalho". Sem nota aberta, raiz. Ref
  // para os call sites em efeitos não precisarem de `current` nas deps.
  const focusedFolderRef = useRef("");
  useEffect(() => {
    focusedFolderRef.current = current?.folder ?? "";
  }, [current?.folder]);

  const createNote = useCallback(
    async (folder = "", title = "", content = "") => {
      try {
        const note = await api.notesCreate(title, content, folder);
        invalidateWikiCache();
        await refreshList();
        // Nota nova = aba nova (append) e focada.
        setOpenTabs((prev) =>
          prev.includes(note.id) ? prev : [...prev, note.id],
        );
        setSelectedId(note.id);
        return note;
      } catch {
        return null;
      }
    },
    [refreshList],
  );

  // "Nova nota" da bandeja (menu do sistema) chega como /notas?new=1: cria uma
  // nota em branco e limpa o parâmetro (para um novo clique valer de novo).
  useEffect(() => {
    if (!newParam) return;
    void createNote(focusedFolderRef.current);
    setSearchParams(
      (prev) => {
        prev.delete("new");
        return prev;
      },
      { replace: true },
    );
  }, [newParam, createNote, setSearchParams]);

  // Atalhos da janela de Notas: ⌘N nova nota, ⌘F focar a busca, ⌘S salvar já.
  // (Formatação — negrito/itálico/títulos/listas — vem do próprio editor.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.altKey || e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (k === "n") {
        e.preventDefault();
        void createNote(focusedFolderRef.current);
      } else if (k === "f") {
        e.preventDefault();
        setSidebarOpen(true);
        setSearchOpen(true);
        setTimeout(() => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        }, 0);
      } else if (k === "s") {
        e.preventDefault();
        void flush();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [createNote, flush]);

  const duplicateNote = useCallback(
    async (n: NoteSummary) => {
      try {
        const full = await api.notesGet(n.id);
        const copy = await api.notesCreate(
          `${full.title} (cópia)`,
          full.content,
          n.folder,
        );
        invalidateWikiCache();
        await refreshList();
        setOpenTabs((prev) =>
          prev.includes(copy.id) ? prev : [...prev, copy.id],
        );
        setSelectedId(copy.id);
      } catch {
        /* silencioso */
      }
    },
    [refreshList],
  );

  const moveNote = useCallback(
    async (id: string, folder: string) => {
      try {
        await api.notesUpdate(id, { folder });
        await refreshList();
      } catch {
        /* silencioso */
      }
    },
    [refreshList],
  );

  // Mover uma PASTA para dentro de outra (ou para a raiz): renomeia o caminho
  // (o backend re-parenteia notas e subpastas). `target` = pasta destino ("" =
  // raiz); o novo caminho é `destino/<nome>`.
  const moveFolder = useCallback(
    async (sourcePath: string, target: string) => {
      const name = sourcePath.split("/").pop() || sourcePath;
      const newPath = target ? `${target}/${name}` : name;
      if (newPath === sourcePath) return;
      try {
        await api.notesRenameFolder(sourcePath, newPath);
        // Mantém a pasta destino aberta para ver o resultado.
        if (target) setExpanded((prev) => new Set(prev).add(target));
        await refreshList();
      } catch {
        /* silencioso */
      }
    },
    [refreshList],
  );

  // Arrastar-e-soltar de notas E pastas entre pastas (ponteiro, testável).
  const { dragOver, ghost, suppressClick, startNoteDrag, startFolderDrag } =
    useNoteDrag(moveNote, moveFolder);

  const confirmRenameNote = useCallback(
    async (id: string, name: string) => {
      setRenamingNoteId(null);
      const trimmed = name.trim();
      if (!trimmed) return;
      try {
        // Renomear edita a PRIMEIRA LINHA do corpo (o título a segue), então a
        // aba e o H1 do editor ficam iguais. Base = conteúdo mais recente: se é
        // a nota aberta, do estado (ou do que está pendente de salvar); senão,
        // busca no servidor.
        let base: string;
        if (current?.id === id) {
          base =
            pending.current?.id === id
              ? pending.current.content
              : current.content ?? "";
        } else {
          base = (await api.notesGet(id)).content ?? "";
        }
        const newContent = withRenamedFirstLine(base, trimmed);
        // Nota aberta: cancela autosave pendente e atualiza o conteúdo no estado
        // — o editor re-hidrata (ver efeito de sync em NoteEditor).
        if (current?.id === id) {
          pending.current = null;
          clearTimeout(saveTimer.current);
          setCurrent((c) => (c && c.id === id ? { ...c, content: newContent } : c));
        }
        const updated = await api.notesUpdate(id, { content: newContent });
        invalidateWikiCache();
        setNotes((prev) =>
          prev.map((n) =>
            n.id === id
              ? { ...n, title: updated.title, snippet: updated.snippet }
              : n,
          ),
        );
        setCurrent((c) => (c && c.id === id ? { ...c, title: updated.title } : c));
        setSaveState("saved");
      } catch {
        /* silencioso */
      }
    },
    [current],
  );

  const copyNoteLink = useCallback(
    (n: NoteSummary) => {
      void navigator.clipboard
        ?.writeText(`[[${n.title}]]`)
        .then(() => showToast("Vínculo copiado", "success"))
        .catch(() => showToast("Não foi possível copiar", "error"));
    },
    [showToast],
  );

  // Favoritar/desfavoritar — otimista, com refresh. Não muda `updated` no
  // backend, então a ordem por recência fica intacta.
  const toggleFavorite = useCallback(
    (n: NoteSummary) => {
      const next = !n.favorite;
      setNotes((prev) =>
        (prev || []).map((x) => (x.id === n.id ? { ...x, favorite: next } : x)),
      );
      void api
        .notesFavorite(n.id, next)
        .then(() => refreshList())
        .catch(() => {
          setNotes((prev) =>
            (prev || []).map((x) =>
              x.id === n.id ? { ...x, favorite: n.favorite } : x,
            ),
          );
        });
    },
    [refreshList],
  );

  // Exporta o markdown da nota (o mais recente — pendente de salvar, se houver).
  const currentMarkdown = useCallback(
    (id: string, fallback: string) =>
      pending.current?.id === id ? pending.current.content : fallback,
    [],
  );

  const exportMarkdown = useCallback(
    (n: NoteSummary, content: string) => {
      const md = currentMarkdown(n.id, content);
      const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = safeFileName(n.title, "md");
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
    [currentMarkdown],
  );

  // Exporta a nota pelo servidor em pdf | html | txt e baixa o arquivo. Manda o
  // markdown ATUAL (com edições ainda não salvas). O .md é local (exportMarkdown).
  const exportServer = useCallback(
    async (n: NoteSummary, fmt: "pdf" | "html" | "txt", fallbackMarkdown: string) => {
      try {
        const token =
          (window as unknown as { __SUPER_NOTEPAD_SESSION_TOKEN__?: string })
            .__SUPER_NOTEPAD_SESSION_TOKEN__ || "";
        const resp = await fetch(
          `/api/notes/${encodeURIComponent(n.id)}/export/${fmt}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Super-Notepad-Session-Token": token,
            },
            body: JSON.stringify({
              content: currentMarkdown(n.id, fallbackMarkdown),
            }),
          },
        );
        if (!resp.ok) throw new Error(String(resp.status));
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = safeFileName(n.title, fmt);
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        showToast(`Exportado ${fmt.toUpperCase()}`, "success");
      } catch {
        showToast(`Falha ao exportar ${fmt.toUpperCase()}`, "error");
      }
    },
    [currentMarkdown, showToast],
  );

  const deleteNote = useCallback(
    (id: string) => {
      setConfirmDel({
        title: "Apagar nota?",
        description: "A ação não pode ser desfeita.",
        run: async () => {
          try {
            await api.notesDelete(id);
            invalidateWikiCache();
            await refreshList();
            // Fecha a aba da nota apagada; se era a ativa, vai para a vizinha.
            const idx = openTabs.indexOf(id);
            const next = openTabs.filter((t) => t !== id);
            setOpenTabs(next);
            if (selectedId === id) {
              setSelectedId(
                next.length ? next[Math.min(idx, next.length - 1)] : null,
              );
            }
          } catch {
            /* silencioso */
          }
        },
      });
    },
    [refreshList, selectedId, openTabs],
  );

  // Criação inline (Docmost): abre um campo na árvore, sem diálogo.
  const startCreateFolder = useCallback((parent = "") => {
    setCreatingIn(parent);
    if (parent) {
      setExpanded((prev) => {
        const next = new Set(prev);
        next.add(parent); // garante a pasta-pai aberta para ver o campo
        return next;
      });
    }
  }, []);

  // Menu nativo → ações da lista/nota. O lado Rust despacha `supernotepad:menu`;
  // aqui reusamos os mesmos handlers dos botões (para menu e clique concordarem).
  useEffect(() => {
    const onMenu = (e: Event) => {
      const detail = (e as CustomEvent<{
        action?: string;
        name?: string;
        content?: string;
      }>).detail;
      switch (detail?.action) {
        case "new-note":
          void createNote(focusedFolderRef.current);
          break;
        case "new-folder":
          startCreateFolder("");
          break;
        case "toggle-list":
          setSidebarOpen((v) => !v);
          break;
        case "focus-search":
          setSidebarOpen(true);
          setSearchOpen(true);
          setTimeout(() => {
            searchInputRef.current?.focus();
            searchInputRef.current?.select();
          }, 0);
          break;
        case "open-file": {
          // "Abrir arquivo…": o Rust já leu o arquivo; criamos uma nota com o
          // conteúdo. O título vem do nome do arquivo (sem extensão).
          const title = (detail.name ?? "Nota importada").replace(/\.[^.]+$/, "");
          void createNote(focusedFolderRef.current, title, detail.content ?? "");
          break;
        }
        default:
          break;
      }
    };
    window.addEventListener("supernotepad:menu", onMenu);
    return () => window.removeEventListener("supernotepad:menu", onMenu);
  }, [createNote, startCreateFolder]);

  const confirmCreateFolder = useCallback(
    async (name: string) => {
      // Nome = UM segmento. "/" digitada no nome não vira aninhamento (isso é o
      // "Nova subpasta"); vira "／" para não quebrar em duas pastas.
      const trimmed = singleFolderSegment(name);
      const parent = creatingIn ?? "";
      setCreatingIn(null);
      if (!trimmed) return;
      const path = parent ? `${parent}/${trimmed}` : trimmed;
      try {
        await api.notesCreateFolder(path);
        await refreshList();
      } catch {
        /* silencioso */
      }
    },
    [creatingIn, refreshList],
  );

  const confirmRenameFolder = useCallback(
    async (path: string, name: string) => {
      setRenamingPath(null);
      // Renomear troca só o ÚLTIMO segmento; "/" no novo nome não deve criar
      // níveis (vira "／"), igual à criação.
      const trimmed = singleFolderSegment(name);
      const parts = path.split("/");
      if (!trimmed || trimmed === parts[parts.length - 1]) return;
      const newPath = [...parts.slice(0, -1), trimmed].join("/");
      try {
        await api.notesRenameFolder(path, newPath);
        await refreshList();
      } catch {
        /* silencioso */
      }
    },
    [refreshList],
  );

  const deleteFolder = useCallback(
    (path: string) => {
      setConfirmDel({
        title: `Apagar a pasta "${path}"?`,
        description: "As notas dela voltam para a raiz (não são apagadas).",
        run: async () => {
          try {
            await api.notesDeleteFolder(path);
            await refreshList();
          } catch {
            /* silencioso */
          }
        },
      });
    },
    [refreshList],
  );

  const toggleFolder = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  // Busca: filtra a lista plana; fora da busca, mostra a árvore de pastas.
  // Ordenação da lista: recentes (por `updated`) ou nome (A→Z). Persiste no
  // dispositivo. `buildFolderTree` preserva a ordem das notas, então ordenar
  // aqui vale para a árvore, a busca e os favoritos.
  const [sortBy, setSortBy] = useState<"recent" | "name">(() => {
    try {
      return localStorage.getItem("notes-sort") === "name" ? "name" : "recent";
    } catch {
      return "recent";
    }
  });
  const toggleSort = () =>
    setSortBy((s) => {
      const next = s === "recent" ? "name" : "recent";
      try {
        localStorage.setItem("notes-sort", next);
      } catch {
        /* ignore */
      }
      return next;
    });
  const sortedNotes = useMemo(() => {
    const arr = [...notes];
    if (sortBy === "name") {
      arr.sort((a, b) =>
        (a.title || "").localeCompare(b.title || "", "pt-BR", {
          sensitivity: "base",
        }),
      );
    } else {
      arr.sort((a, b) => (b.updated || "").localeCompare(a.updated || ""));
    }
    return arr;
  }, [notes, sortBy]);

  const filteredNotes = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return sortedNotes.filter(
      (n) =>
        n.title.toLowerCase().includes(q) || n.snippet.toLowerCase().includes(q),
    );
  }, [sortedNotes, query]);

  const tree = useMemo(
    () => buildFolderTree(folders, sortedNotes),
    [folders, sortedNotes],
  );
  const favorites = useMemo(
    () => sortedNotes.filter((n) => n.favorite),
    [sortedNotes],
  );

  // Itens de menu de uma nota. Mover ficou só no arraste (com o mouse), então
  // Abre uma nota na aba ATUAL: substitui a nota da aba ativa (não abre outra).
  // Se a nota já estiver aberta noutra aba, só a foca; sem abas, cria a primeira.
  const openNote = useCallback(
    (id: string) => {
      setOpenTabs((prev) => {
        if (prev.includes(id)) return prev;
        if (!prev.length) return [id];
        // Não substitui a aba-rascunho — ela se finaliza sozinha ao sair.
        if (selectedId === DRAFT_ID) return [...prev, id];
        // Aba atual com alterações → NÃO substitui: a nova nota abre em aba
        // nova, preservando o que estava sendo editado.
        if (selectedId && dirtyTabsRef.current.has(selectedId))
          return [...prev, id];
        return prev.map((t) => (t === selectedId ? id : t));
      });
      setSelectedId(id);
    },
    [selectedId],
  );

  // Abre uma aba-rascunho em branco: NÃO cria nota até o usuário digitar.
  const openDraft = useCallback(() => {
    // Nasce na pasta FOCADA (a da nota aberta agora), não na raiz.
    draftFolderRef.current = focusedFolderRef.current;
    setOpenTabs((prev) => {
      if (prev.includes(DRAFT_ID)) return prev;
      draftRealId.current = null;
      return [...prev, DRAFT_ID];
    });
    setDraftTitle("");
    setSelectedId(DRAFT_ID);
  }, []);

  // Fecha uma aba; se era a ativa, passa para a vizinha (ou nenhuma).
  const closeTab = useCallback(
    (id: string) => {
      // Fechar a aba-rascunho: zera o rascunho (a nota, se criada ao digitar,
      // permanece na lista; se nada foi digitado, não havia nota).
      if (id === DRAFT_ID) {
        draftRealId.current = null;
        setDraftTitle("");
      }
      // Aba fechada deixa de ser "suja".
      dirtyTabsRef.current.delete(id);
      const idx = openTabs.indexOf(id);
      const next = openTabs.filter((t) => t !== id);
      setOpenTabs(next);
      if (selectedId === id) {
        setSelectedId(next.length ? next[Math.min(idx, next.length - 1)] : null);
      }
    },
    [openTabs, selectedId],
  );

  // não polui o menu com uma linha por pasta.
  const noteMenu = useCallback(
    (n: NoteSummary): ContextMenuEntry[] => [
      { label: "Abrir", icon: FileText, onSelect: () => openNote(n.id) },
      {
        label: n.favorite ? "Desfavoritar" : "Favoritar",
        icon: Star,
        onSelect: () => toggleFavorite(n),
      },
      { label: "Renomear", icon: Pencil, onSelect: () => setRenamingNoteId(n.id) },
      { label: "Duplicar", icon: Copy, onSelect: () => void duplicateNote(n) },
      {
        label: "Copiar vínculo",
        icon: Link2,
        onSelect: () => copyNoteLink(n),
      },
      {
        label: "Exportar .md",
        icon: Download,
        onSelect: () =>
          void api
            .notesGet(n.id)
            .then((full) => exportMarkdown(n, full.content ?? ""))
            .catch(() => {}),
      },
      "separator",
      {
        label: "Apagar",
        icon: Trash2,
        danger: true,
        onSelect: () => void deleteNote(n.id),
      },
    ],
    [duplicateNote, deleteNote, copyNoteLink, openNote, toggleFavorite, exportMarkdown],
  );

  // A indentação/hierarquia vem dos containers com borda-guia (ver renderFolder),
  // então a linha em si tem só um respiro fixo à esquerda.
  const noteRow = (n: NoteSummary) =>
    renamingNoteId === n.id ? (
      <InlineNameInput
        key={n.id}
        initial={n.title}
        placeholder="Nome da nota"
        pl="pl-6"
        onConfirm={(name) => void confirmRenameNote(n.id, name)}
        onCancel={() => setRenamingNoteId(null)}
      />
    ) : (
    <ContextMenu key={n.id} items={noteMenu(n)}>
      <button
        type="button"
        onPointerDown={(e) => startNoteDrag(e, n)}
        onClick={() => {
          // Se acabou um arraste, o clique que o segue não deve selecionar.
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          openNote(n.id);
        }}
        className={cn(
          // `select-none`: idem pasta — evita o botão direito selecionar o
          // título e o WKWebView abrir o "Copiar ⌘C" nativo sobre o menu custom.
          "group relative flex h-8 w-full select-none items-center gap-2 rounded-md pl-6 pr-2 text-left transition-colors",
          // Entrada suave só fora da busca — durante a busca a lista filtra a
          // cada tecla e re-animar aqui deixaria o sidebar "piscando".
          !query.trim() && "list-stagger-item",
          n.id === selectedId
            ? "bg-(--primary-muted) font-medium text-foreground"
            : "text-muted-foreground hover:bg-(--surface-hover) hover:text-foreground",
        )}
      >
        {n.id === selectedId ? (
          <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r-full bg-primary" />
        ) : null}
        <span className="flex-1 whitespace-nowrap text-sm">
          {n.title || "Sem título"}
        </span>
        {n.favorite ? (
          <Star
            className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400"
            aria-label="Favorita"
          />
        ) : null}
        <span className="shrink-0 text-2xs text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/60">
          {n.updated ? isoTimeAgo(n.updated) : ""}
        </span>
      </button>
    </ContextMenu>
    );

  const folderMenu = (path: string): ContextMenuEntry[] => [
    { label: "Nova nota aqui", icon: FilePlus2, onSelect: () => void createNote(path) },
    { label: "Nova subpasta", icon: FolderPlus, onSelect: () => startCreateFolder(path) },
    { label: "Renomear", icon: Pencil, onSelect: () => setRenamingPath(path) },
    "separator",
    {
      label: "Apagar pasta",
      icon: Trash2,
      danger: true,
      onSelect: () => void deleteFolder(path),
    },
  ];

  const renderFolder = (node: FolderNode): ReactNode => {
    const isOpen = expanded.has(node.path);
    const isDropTarget = dragOver === node.path;
    if (renamingPath === node.path) {
      return (
        <div key={node.path} data-folder-path={node.path}>
          <InlineNameInput
            initial={node.name}
            onConfirm={(name) => void confirmRenameFolder(node.path, name)}
            onCancel={() => setRenamingPath(null)}
          />
        </div>
      );
    }
    return (
      <div key={node.path} data-folder-path={node.path}>
        <ContextMenu items={folderMenu(node.path)}>
          <button
            type="button"
            onPointerDown={(e) =>
              startFolderDrag(e, { path: node.path, name: node.name })
            }
            onClick={() => {
              // Se acabou de arrastar, não alterna (o clique-de-fim-de-arraste).
              if (suppressClick.current) {
                suppressClick.current = false;
                return;
              }
              toggleFolder(node.path);
            }}
            aria-expanded={isOpen}
            aria-label={`Pasta ${node.name}`}
            className={cn(
              // `select-none`: sem isto, o botão direito SELECIONAVA o nome da
              // pasta e o WKWebView abria o menu NATIVO "Copiar ⌘C" POR CIMA do
              // nosso menu de contexto (dois menus). O menu custom já dá
              // preventDefault; falta impedir a seleção.
              "group flex h-8 w-full select-none items-center gap-1.5 rounded-md pl-1.5 pr-1.5 text-left text-muted-foreground transition-colors hover:bg-(--surface-hover)",
              isDropTarget &&
                "bg-(--primary-muted) ring-1 ring-inset ring-primary/40",
            )}
          >
            <ChevronRight
              className={cn(
                "h-3.5 w-3.5 shrink-0 text-muted-foreground/60 transition-transform",
                isOpen && "rotate-90",
              )}
            />
            <span className="flex-1 whitespace-nowrap text-sm text-foreground">
              {node.name}
            </span>
            {/* Ação rápida no hover: nova nota dentro da pasta. */}
            <span
              role="button"
              tabIndex={-1}
              aria-label="Nova nota nesta pasta"
              onClick={(e) => {
                e.stopPropagation();
                void createNote(node.path);
              }}
              className="hidden h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-(--surface-hover) hover:text-foreground group-hover:flex"
            >
              <FilePlus2 className="h-3.5 w-3.5" />
            </span>
            <span className="w-5 shrink-0 text-right text-2xs text-muted-foreground/60 group-hover:hidden">
              {node.count}
            </span>
          </button>
        </ContextMenu>
        {isOpen ? (
          // Container com borda-guia: a linha vertical mostra a hierarquia
          // (estilo Docmost/VSCode); a margem indenta o nível. Ao abrir, o
          // conteúdo entra com um fade+slide sutil (note-tree-reveal).
          <div className="notes-tree-guide note-tree-reveal ml-[15px] pl-2">
            {creatingIn === node.path ? (
              <InlineNameInput
                onConfirm={(name) => void confirmCreateFolder(name)}
                onCancel={() => setCreatingIn(null)}
              />
            ) : null}
            {node.children.map((child) => renderFolder(child))}
            {node.notes.map((n) => noteRow(n))}
          </div>
        ) : null}
      </div>
    );
  };

  // Ações que moram na barra de título (ao lado das bolinhas no desktop; num
  // cabeçalho mínimo no navegador): ocultar/mostrar a lista, ordenar, nova pasta
  // e nova nota. Ficavam soltas — parte na sidebar, parte no corpo. Juntá-las no
  // topo aproveita a faixa da janela e enxuga a sidebar (que fica só com a busca).
  // Botões enxutos (h-7) para caber na faixa de 32px.
  const headerActions = (
    <div className="flex items-center gap-0.5">
      <Tooltip content={sidebarOpen ? "Ocultar lista" : "Mostrar lista"}>
        <button
          type="button"
          onClick={() => setSidebarOpen((v) => !v)}
          aria-label={sidebarOpen ? "Ocultar lista" : "Mostrar lista"}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-(--surface-hover) hover:text-foreground"
        >
          <PanelLeft className="h-4.5 w-4.5" />
        </button>
      </Tooltip>
      <Tooltip
        content={
          sortBy === "recent"
            ? "Ordenar por nome (A→Z)"
            : "Ordenar por recentes"
        }
      >
        <button
          type="button"
          onClick={toggleSort}
          aria-label={
            sortBy === "recent"
              ? "Ordenando por recentes — clique para ordenar por nome"
              : "Ordenando por nome — clique para ordenar por recentes"
          }
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-(--surface-hover) hover:text-foreground"
        >
          {sortBy === "recent" ? (
            <ArrowDownWideNarrow className="h-4.5 w-4.5" />
          ) : (
            <ArrowDownAZ className="h-4.5 w-4.5" />
          )}
        </button>
      </Tooltip>
      <Tooltip content="Nova pasta">
        <button
          type="button"
          onClick={() => startCreateFolder("")}
          aria-label="Nova pasta"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-(--surface-hover) hover:text-foreground"
        >
          <FolderPlus className="h-4.5 w-4.5" />
        </button>
      </Tooltip>
      <Tooltip content="Buscar">
        <button
          type="button"
          onClick={() => {
            setSidebarOpen(true);
            setSearchOpen((v) => {
              const next = !v;
              if (next) {
                // foca o campo assim que ele aparecer
                setTimeout(() => searchInputRef.current?.focus(), 0);
              } else {
                setQuery("");
              }
              return next;
            });
          }}
          aria-label="Buscar notas"
          aria-pressed={searchOpen}
          className={cn(
            "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-(--surface-hover) hover:text-foreground",
            searchOpen ? "bg-(--surface-hover) text-foreground" : "text-muted-foreground",
          )}
        >
          <Search className="h-4.5 w-4.5" />
        </button>
      </Tooltip>
      <Tooltip content="Nova nota">
        <button
          type="button"
          onClick={() => void createNote(focusedFolderRef.current)}
          aria-label="Nova nota"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-(--primary-muted) text-primary transition-colors hover:bg-(--surface-hover)"
        >
          <FilePlus2 className="h-4.5 w-4.5" />
        </button>
      </Tooltip>
    </div>
  );

  const treeContent = loading ? (
    <p className="px-3 py-4 text-sm text-muted-foreground">Carregando…</p>
  ) : filteredNotes ? (
    filteredNotes.length === 0 ? (
      <div className="flex flex-col items-start gap-2 px-3 py-4">
        <p className="text-sm text-muted-foreground">
          Nenhuma nota para “{query.trim()}”.
        </p>
        <button
          type="button"
          onClick={() => {
            const title = query.trim();
            setQuery("");
            void createNote("", title, `# ${title}\n\n`);
          }}
          className="inline-flex items-center gap-1.5 rounded-md bg-(--primary-muted) px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-(--surface-hover)"
        >
          <Plus className="h-3.5 w-3.5" />
          Criar nota “{query.trim()}”
        </button>
      </div>
    ) : (
      <div>
        <p className="px-3 pb-1 pt-2 text-2xs font-medium uppercase tracking-wide text-muted-foreground/60">
          {filteredNotes.length}{" "}
          {filteredNotes.length === 1 ? "resultado" : "resultados"}
        </p>
        {filteredNotes.map((n) => noteRow(n))}
      </div>
    )
  ) : notes.length === 0 && folders.length === 0 && creatingIn !== "" ? (
    <p className="px-3 py-4 text-sm text-muted-foreground">
      Nenhuma nota ainda. Crie a primeira.
    </p>
  ) : (
    <div>
      {creatingIn === "" ? (
        <InlineNameInput
          onConfirm={(name) => void confirmCreateFolder(name)}
          onCancel={() => setCreatingIn(null)}
        />
      ) : null}
      {favorites.length > 0 ? (
        <div className="mb-1">
          <div className="flex items-center gap-1.5 px-2 pb-0.5 pt-1 text-2xs font-semibold uppercase tracking-wide text-muted-foreground/70">
            <Star className="h-3 w-3 fill-amber-400 text-amber-400" /> Favoritas
          </div>
          {favorites.map((n) => (
            <div key={`fav-${n.id}`}>{noteRow(n)}</div>
          ))}
          <div className="my-1.5 h-px bg-(--divider)" />
        </div>
      ) : null}
      {tree.children.map((child) => renderFolder(child))}
      {tree.notes.map((n) => noteRow(n))}
    </div>
  );

  // Abas: só as que ainda existem (uma nota removida por fora não deixa aba
  // fantasma). O título vem da lista, que acompanha edições. A aba-rascunho
  // (DRAFT_ID) é sintética — rótulo "Nova nota" até a 1ª linha ser digitada.
  const tabItems = openTabs
    .map((id): NoteSummary | undefined =>
      id === DRAFT_ID
        ? {
            id: DRAFT_ID,
            title: draftTitle || "Nova nota",
            snippet: "",
            folder: "",
            created: "",
            updated: "",
          }
        : notes.find((n) => n.id === id),
    )
    .filter((n): n is NoteSummary => Boolean(n));

  return (
    // Full-bleed, sem cards, com um HEADER único no topo: a busca, o controle da
    // lista e as ações da nota moram nele (aproveitando a barra), em vez de
    // repetir controles no sidebar e no editor.
    <div className="flex h-full min-h-0 w-full flex-col">
      {/* No desktop o toggle da lista vive na faixa da janela (portal), então
          não há barra de cabeçalho aqui. No navegador, uma barra mínima só com
          o toggle. O título da nota é a primeira linha do editor; o status de
          salvamento virou um ícone de sync na barra de ferramentas. */}
      {!titlebarSlot ? (
        <header className="flex items-center border-b border-solid border-(--divider) px-2.5 py-1.5">
          {headerActions}
        </header>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {/* Lista: só a árvore (o cabeçalho subiu para o header). Separada por
            luminosidade, sem moldura de card. Abre/fecha animando a largura;
            o conteúdo fica em largura fixa dentro para não espremer. */}
        <aside
          className={cn(
            "shrink-0 overflow-hidden bg-(--surface)/50",
            !resizing && "transition-[width] duration-200 ease-out",
            sidebarOpen
              ? "border-r border-solid border-(--divider)"
              : "w-0 border-r-0",
          )}
          style={sidebarOpen ? { width: sidebarWidth } : undefined}
        >
          <div
            className="flex h-full flex-col"
            style={{ width: sidebarWidth }}
          >
            {/* Busca OCULTA por padrão — a lupa em headerActions a revela.
                Ordenar / nova pasta / nova nota moram na barra de título. */}
            {searchOpen ? (
              <div className="px-2.5 pt-2.5 pb-1.5">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    ref={searchInputRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      // Esc limpa a busca; se já vazia, fecha o campo.
                      if (e.key === "Escape") {
                        e.preventDefault();
                        if (query) setQuery("");
                        else setSearchOpen(false);
                      }
                    }}
                    placeholder={`Buscar… (${platformShortcut("⌘F")})`}
                    className={cn("h-9 pl-8", query && "pr-8")}
                    aria-label="Buscar notas"
                  />
                  {query ? (
                    <button
                      type="button"
                      onClick={() => {
                        setQuery("");
                        searchInputRef.current?.focus();
                      }}
                      aria-label="Limpar busca"
                      className="absolute right-1.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-(--surface-hover) hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {/* Toda a área da lista: alvo de soltura da raiz + menu de contexto
                (botão direito no vazio) para criar nota/pasta na raiz. */}
            <ContextMenu
              items={[
                {
                  label: "Nova nota",
                  icon: FilePlus2,
                  onSelect: () => void createNote(focusedFolderRef.current),
                },
                {
                  label: "Nova pasta",
                  icon: FolderPlus,
                  onSelect: () => startCreateFolder(""),
                },
              ]}
            >
              <div
                data-folder-path=""
                className={cn(
                  // Rola nos dois eixos: pastas fundas e nomes longos passam a
                  // ser alcançáveis rolando na horizontal, em vez de cortados.
                  "notes-tree-scroll min-h-0 flex-1 overflow-auto px-1.5 pb-2",
                  dragOver === "" && "bg-(--primary-muted)/40",
                )}
              >
                {/* `w-max min-w-full`: preenche a largura visível (linhas cheias)
                    mas cresce até o item mais largo — o que gera o scroll-x. */}
                <div className="w-max min-w-full">{treeContent}</div>
              </div>
            </ContextMenu>
          </div>
        </aside>

        {/* Alça de redimensionamento da lista — arraste para largar/estreitar. */}
        {sidebarOpen ? (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Redimensionar lista"
            onPointerDown={onResizeStart}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeEnd}
            onDoubleClick={() => {
              setSidebarWidth(256);
              try {
                localStorage.setItem("super-notepad.notes.sidebarWidth", "256");
              } catch {
                /* ignore */
              }
            }}
            className={cn(
              "group relative z-10 -ml-1 w-2 shrink-0 cursor-col-resize touch-none select-none",
              resizing && "cursor-col-resize",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors",
                resizing
                  ? "bg-primary/60"
                  : "bg-transparent group-hover:bg-primary/40",
              )}
            />
          </div>
        ) : null}

        <section className="relative flex min-h-0 flex-1 bg-(--surface)/50">
          {/* Coluna esquerda (abas + editor): min-w-0 para ENCOLHER quando o
              painel de chat abre — o painel EMPURRA, não sobrepõe. */}
          <div className="relative flex min-w-0 flex-1 flex-col">
          {/* Abas das notas abertas (estilo editor de código): retangulares,
              separadas por divisórias, a ativa realçada por uma barra no topo e
              o fundo escuro do conteúdo. O "+" abre uma nota nova numa aba. */}
          <NoteTabsBar
            tabItems={tabItems}
            selectedId={selectedId}
            setSelectedId={setSelectedId}
            closeTab={closeTab}
            openDraft={openDraft}
          />

          {current ? (
            <NoteEditor
              key={current.id}
              noteId={current.id}
              markdown={current.content}
              folderPath={current.id === DRAFT_ID ? "" : current.folder}
              onShowHistory={
                current.id === DRAFT_ID ? undefined : () => setHistoryOpen(true)
              }
              onChange={onEditorChange}
              saveState={saveState}
              favorite={
                current.id === DRAFT_ID
                  ? undefined
                  : (notes.find((n) => n.id === current.id)?.favorite ??
                    current.favorite)
              }
              onToggleFavorite={
                current.id === DRAFT_ID
                  ? undefined
                  : () =>
                      toggleFavorite(
                        notes.find((n) => n.id === current.id) ?? current,
                      )
              }
              menuSlot={
                current.id === DRAFT_ID ? undefined : (
                <NoteMoreMenu
                  // Mescla o estado vivo da lista (favorite/locked/title) sobre
                  // a nota carregada — senão o rótulo do menu ("Bloquear" vs
                  // "Desbloquear") fica preso no valor de quando a nota abriu.
                  note={{
                    ...current,
                    ...(notes.find((n) => n.id === current.id) ?? {}),
                  }}
                  folders={folders}
                  onRename={(name) => void confirmRenameNote(current.id, name)}
                  onDuplicate={() => void duplicateNote(current)}
                  onCopyLink={() => copyNoteLink(current)}
                  onToggleFavorite={() => toggleFavorite(current)}
                  onExportMd={() => exportMarkdown(current, current.content)}
                  onExportPdf={() => void exportServer(current, "pdf", current.content)}
                  onExportHtml={() => void exportServer(current, "html", current.content)}
                  onExportTxt={() => void exportServer(current, "txt", current.content)}
                  onCopyMarkdown={() => {
                    // Copia o markdown MAIS RECENTE (o que está pendente de
                    // salvar, se houver; senão o carregado).
                    const md =
                      pending.current?.id === current.id
                        ? pending.current.content
                        : current.content;
                    void navigator.clipboard
                      ?.writeText(md ?? "")
                      .then(() => showToast("Markdown copiado", "success"))
                      .catch(() =>
                        showToast("Não foi possível copiar", "error"),
                      );
                  }}
                  onMove={(folder) => void moveNote(current.id, folder)}
                  onDelete={() => deleteNote(current.id)}
                />
                )
              }
              onOpenNote={(id) => openNote(id)}
              onCreateNote={(title) =>
                createNote(current.folder, title, `# ${title}\n\n`).then((n) =>
                  n ? { id: n.id } : null,
                )
              }
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
              <NotebookPen className="h-8 w-8 opacity-60" />
              <p className="text-sm">
                {notes.length === 0
                  ? "Crie sua primeira nota."
                  : "Escolha uma nota à esquerda."}
              </p>
              <button
                type="button"
                onClick={() => void createNote(focusedFolderRef.current)}
                className="rounded-lg bg-(--primary-muted) px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-(--surface-hover)"
              >
                Nova nota
              </button>
            </div>
          )}

          </div>
        </section>
      </div>

      {titlebarSlot ? createPortal(headerActions, titlebarSlot) : null}

      <ConfirmDialog
        open={!!confirmDel}
        title={confirmDel?.title ?? ""}
        description={confirmDel?.description}
        destructive={confirmDel?.destructive ?? true}
        confirmLabel={confirmDel?.confirmLabel ?? "Apagar"}
        onConfirm={() => {
          const c = confirmDel;
          setConfirmDel(null);
          c?.run();
        }}
        onCancel={() => setConfirmDel(null)}
      />

      {current && current.id !== DRAFT_ID ? (
        <NoteHistoryModal
          noteId={current.id}
          noteTitle={current.title}
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          onRestored={(note) => {
            // Reflete o conteúdo restaurado no editor e na lista, na hora.
            setCurrent(note);
            void refreshList();
          }}
        />
      ) : null}

      <Toast toast={toast} />

      {/* Fantasma do arraste — segue o cursor, sem capturar eventos (para o
          hit-test enxergar a pasta embaixo). */}
      {ghost
        ? createPortal(
            <div
              className="pointer-events-none fixed z-[200] max-w-56 truncate rounded-md border border-solid border-(--border-strong) bg-(--popover-bg) px-2 py-1 text-xs font-medium text-foreground shadow-none"
              style={{ left: ghost.x + 12, top: ghost.y + 8 }}
            >
              {ghost.title}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
