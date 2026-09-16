import { MessageSquare, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { type Note, type NoteLinkRef } from "@/lib/api";

/**
 * Painel de chat sobre a nota, na própria tela. Reusa o /chat inteiro num iframe
 * (mesma origem, autenticado pelo cookie), semeado com o rascunho da nota. Irmão
 * flex (não `absolute`): EMPURRA a coluna do editor em vez de sobrepor — o texto
 * reflui na largura que sobra.
 */
export function NoteChatPanel({
  current,
  chatSrc,
  iframeKey,
  linkedChats,
  activeChatSid,
  onSelectChat,
  onNewConversation,
  onClose,
}: {
  current: Note | null;
  chatSrc: string;
  iframeKey: string;
  linkedChats: NoteLinkRef[];
  activeChatSid: string | null;
  onSelectChat: (id: string) => void;
  onNewConversation: () => void;
  onClose: () => void;
}) {
  return (
    <div className="chat-note-panel flex w-[min(440px,45%)] shrink-0 flex-col bg-(--card-bg)">
      {/* Bloco de topo (header + conversas) com bg discreto próprio,
          separado do corpo do chat por uma linha nítida. */}
      {/* Header minimalista: ícone + título da nota + fechar. */}
      <div className="flex shrink-0 items-center gap-2 px-4 py-3">
        <MessageSquare className="h-3.5 w-3.5 shrink-0 text-primary" />
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {current?.title?.trim() || "Sobre a nota"}
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar chat"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-(--surface-hover) hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {/* Barra de conversas da nota: chips (trocar) + "Nova conversa". */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-solid border-(--divider) px-4 pb-3 pt-0.5">
        <div className="ui-scrollbar flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {linkedChats.length === 0 ? (
            <span className="px-1 text-2xs text-muted-foreground/70">
              Conversa nova sobre esta nota
            </span>
          ) : (
            linkedChats.map((c) => {
              const active = c.id === activeChatSid;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onSelectChat(c.id)}
                  title={c.title}
                  className={cn(
                    "inline-flex max-w-[150px] shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors",
                    active
                      ? "bg-(--primary-muted) text-primary ring-1 ring-inset ring-primary/40"
                      : "text-muted-foreground hover:bg-(--surface-hover) hover:text-foreground",
                  )}
                >
                  <MessageSquare className="h-3 w-3 shrink-0 opacity-80" />
                  <span className="truncate">{c.title}</span>
                </button>
              );
            })
          )}
        </div>
        <button
          type="button"
          onClick={onNewConversation}
          title="Iniciar uma conversa nova sobre a nota"
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed px-2.5 py-1 text-xs font-medium transition-colors",
            activeChatSid === null
              ? "border-primary/50 bg-(--primary-muted) text-primary"
              : "border-(--border-strong) text-muted-foreground hover:border-primary/50 hover:text-primary",
          )}
        >
          <Plus className="h-3.5 w-3.5" /> Nova conversa
        </button>
      </div>
      <iframe
        key={iframeKey}
        src={chatSrc}
        title="Chat sobre a nota"
        className="min-h-0 w-full flex-1 border-0 bg-background"
      />
    </div>
  );
}
