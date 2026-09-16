import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Image } from "@tiptap/extension-image";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { Check, Copy, X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Copia a imagem para a área de transferência como PNG. O attachment é
 *  same-origin e autenticado (o <img> já carrega), então o fetch com
 *  credenciais funciona; converte para PNG porque é o formato que a Clipboard
 *  API aceita com segurança. */
export async function copyImageToClipboard(src: string): Promise<boolean> {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
    return false;
  }
  try {
    const pngBlob = (async () => {
      const resp = await fetch(src, { credentials: "include" });
      const blob = await resp.blob();
      if (blob.type === "image/png") return blob;
      const bmp = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("sem canvas 2d");
      ctx.drawImage(bmp, 0, 0);
      return await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("toBlob falhou"))),
          "image/png",
        ),
      );
    })();
    await navigator.clipboard.write([
      new ClipboardItem({ "image/png": pngBlob }),
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Visualização em tela cheia da imagem — abre no duplo-clique. Fecha no clique
 * no fundo, no botão, ou com Esc. Portada para o `body` (fica acima de tudo,
 * fora do fluxo do editor).
 */
export function ImageLightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onCopy = async () => {
    const ok = await copyImageToClipboard(src);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt || "Imagem"}
      onClick={onClose}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm motion-fade-in"
    >
      <div
        className="absolute right-4 top-4 flex items-center gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => void onCopy()}
          aria-label="Copiar imagem"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-white/10 px-3 text-sm text-white/90 transition-colors hover:bg-white/20"
        >
          {copied ? (
            <Check className="h-4 w-4" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
          {copied ? "Copiado" : "Copiar"}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-white/90 transition-colors hover:bg-white/20"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <img
        src={src}
        alt={alt}
        onClick={(e) => e.stopPropagation()}
        className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
        draggable={false}
      />
    </div>,
    document.body,
  );
}

/**
 * Mídia redimensionável (imagem e vídeo) para as Notas.
 *
 * As notas são markdown, e `![alt](url)` não carrega largura nem tipo. Em vez de
 * ligar HTML no markdown (perigoso) ou inventar sintaxe, guardamos os metadados
 * no PRÓPRIO `alt`, no estilo do Obsidian: `nome|video|w=320`. O `alt` é texto e
 * viaja intacto no markdown, então largura e "é vídeo" sobrevivem ao salvar.
 *
 * O nó continua sendo o `image` do TipTap (o tiptap-markdown já sabe serializá-lo
 * como `![alt](url)`); só trocamos a renderização por este NodeView, que desenha
 * <img> ou <video> e uma alça de redimensionar no canto.
 */

type AltMeta = { name: string; isVideo: boolean; width: number | null };

function parseAlt(alt: string): AltMeta {
  const parts = (alt || "").split("|").map((s) => s.trim());
  const name = parts[0] || "";
  const isVideo = parts.slice(1).some((p) => p.toLowerCase() === "video");
  const wPart = parts.find((p) => /^w=\d+$/i.test(p));
  return { name, isVideo, width: wPart ? parseInt(wPart.slice(2), 10) : null };
}

function buildAlt(alt: string, width: number): string {
  const parts = (alt || "")
    .split("|")
    .map((s) => s.trim())
    .filter((p) => p && !/^w=\d+$/i.test(p));
  parts.push(`w=${Math.round(width)}`);
  return parts.join("|");
}

function MediaNodeView({
  node,
  updateAttributes,
  selected,
  editor,
}: NodeViewProps) {
  const alt = (node.attrs.alt as string) || "";
  const src = (node.attrs.src as string) || "";
  const { name, isVideo, width } = parseAlt(alt);
  const frameRef = useRef<HTMLDivElement>(null);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const editable = editor.isEditable;

  const startResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startW = frameRef.current?.offsetWidth ?? 320;
      const maxW =
        frameRef.current?.parentElement?.parentElement?.offsetWidth ?? 900;
      const clamp = (w: number) => Math.max(96, Math.min(maxW, w));
      const onMove = (ev: MouseEvent) =>
        setDragWidth(clamp(startW + (ev.clientX - startX)));
      const onUp = (ev: MouseEvent) => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        setDragWidth(null);
        updateAttributes({ alt: buildAlt(alt, clamp(startW + (ev.clientX - startX))) });
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [alt, updateAttributes],
  );

  const shown = dragWidth ?? width;

  return (
    <NodeViewWrapper
      className={cn("note-media", selected && "note-media-selected")}
    >
      <div
        ref={frameRef}
        className="note-media-frame"
        style={shown ? { width: `${shown}px` } : undefined}
      >
        {isVideo ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video src={src} controls className="note-media-el" preload="metadata" />
        ) : (
          <img
            src={src}
            alt={name}
            className="note-media-el cursor-zoom-in"
            draggable={false}
            onDoubleClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setViewerOpen(true);
            }}
          />
        )}
        {editable ? (
          <span
            className="note-media-handle"
            onMouseDown={startResize}
            role="slider"
            aria-label="Redimensionar"
            aria-hidden
          />
        ) : null}
      </div>
      {viewerOpen && !isVideo ? (
        <ImageLightbox src={src} alt={name} onClose={() => setViewerOpen(false)} />
      ) : null}
    </NodeViewWrapper>
  );
}

/** Nó `image` do TipTap com renderização própria (mídia redimensionável). */
export const NoteMedia = Image.extend({
  addNodeView() {
    return ReactNodeViewRenderer(MediaNodeView);
  },
});
