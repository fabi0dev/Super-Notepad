import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Modal, ModalPanel, ModalHeader, ModalBody } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/useToast";

/**
 * Contexto de uma PASTA de notas: um texto livre do que a pasta/projeto É +
 * tags de memória vinculadas. O agente injeta isso ao ler/conversar sobre notas
 * da pasta (ver super_notepad/notes_store `folder-meta` e tools/notes_tool). Assim as
 * respostas ficam sob medida pro projeto, sem o usuário repetir o contexto.
 */
export function FolderContextDialog({
  open,
  folder,
  onClose,
}: {
  open: boolean;
  folder: string | null;
  onClose: () => void;
}) {
  const { showToast } = useToast();
  const [context, setContext] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Tags de memória disponíveis (nome + descrição) para escolher da lista.
  const tagsQuery = useQuery({
    queryKey: ["notes", "memory-tags"],
    queryFn: () => api.notesMemoryTags(),
    enabled: open,
    staleTime: 60_000,
  });

  // Carrega o contexto atual da pasta ao abrir.
  useEffect(() => {
    if (!open || !folder) return;
    let alive = true;
    void api
      .notesFolderContext(folder)
      .then((res) => {
        if (!alive) return;
        setContext(res.context || "");
        setTags(res.memory_tags || []);
      })
      .catch(() => {
        if (!alive) return;
        setContext("");
        setTags([]);
      });
    return () => {
      alive = false;
    };
  }, [open, folder]);

  const toggleTag = (tag: string) => {
    setTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

  const save = async () => {
    if (!folder) return;
    setSaving(true);
    try {
      await api.notesSetFolderContext(folder, context.trim(), tags);
      showToast("Contexto da pasta salvo.", "success");
      onClose();
    } catch {
      showToast("Não consegui salvar o contexto.", "error");
    } finally {
      setSaving(false);
    }
  };

  const available = tagsQuery.data?.tags ?? [];

  return (
    <Modal open={open} onBackdropClick={onClose} align="center">
      <ModalPanel labelledBy="folder-context-title" className="w-full max-w-2xl">
        <ModalHeader
          titleId="folder-context-title"
          title="Contexto da pasta"
          subtitle={
            folder
              ? `Super Notepad usa isto ao trabalhar com notas de "${folder.split("/").pop()}".`
              : undefined
          }
          onClose={onClose}
        />
        <ModalBody className="space-y-5 pt-5">
          <section className="space-y-2">
            <label
              htmlFor="folder-context-text"
              className="block text-sm font-medium text-foreground"
            >
              Sobre esta pasta
            </label>
            <Textarea
              id="folder-context-text"
              value={context}
              onChange={(e) => setContext(e.target.value)}
              rows={4}
              placeholder="O que é este projeto? Ex.: App AXIS (web + mobile), foco em bugs e QA; convenções do repositório axis-web."
            />
          </section>

          <section className="space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium text-foreground">
                Memórias vinculadas
              </span>
              <span className="text-xs text-muted-foreground">
                {tags.length > 0
                  ? `${tags.length} selecionada${tags.length > 1 ? "s" : ""}`
                  : "opcional"}
              </span>
            </div>
            {available.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">
                {tagsQuery.isLoading
                  ? "Carregando tags…"
                  : "Nenhuma tag de memória ainda."}
              </p>
            ) : (
              <div className="grid max-h-72 grid-cols-2 gap-1.5 overflow-y-auto pr-1">
                {available.map(({ tag, description }) => {
                  const on = tags.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => toggleTag(tag)}
                      title={description || undefined}
                      className={cn(
                        "flex items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors",
                        on
                          ? "bg-(--primary-muted)"
                          : "hover:bg-(--surface-hover)",
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded border text-2xs transition-colors",
                          on
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-(--divider) text-transparent",
                        )}
                        aria-hidden
                      >
                        ✓
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">
                          #{tag}
                        </span>
                        {description ? (
                          <span className="block truncate text-2xs text-muted-foreground/80">
                            {description}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              variant="brand"
              size="sm"
              onClick={() => void save()}
              disabled={saving}
            >
              {saving ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        </ModalBody>
      </ModalPanel>
    </Modal>
  );
}
