import { useCallback, useRef } from "react";
import type { PointerEvent as ReactPointerEvent, MouseEvent } from "react";

/**
 * Fecha um diálogo ao clicar no backdrop — sem fechar durante uma seleção.
 *
 * `onClick` com `e.target === e.currentTarget` parece suficiente, mas não é:
 * o evento `click` dispara no ancestral COMUM do mousedown e do mouseup.
 * Selecionar texto dentro do painel e soltar o botão um pixel fora faz do
 * backdrop esse ancestral comum, então `target === currentTarget` vira
 * verdadeiro e o diálogo fecha no meio da seleção — perdendo o que a pessoa
 * estava copiando, e às vezes o que ela estava escrevendo.
 *
 * Só fecha quando a interação COMEÇOU e TERMINOU no backdrop.
 */
export function useBackdropDismiss(onDismiss?: () => void) {
  const startedOnBackdrop = useRef(false);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    startedOnBackdrop.current = e.target === e.currentTarget;
  }, []);

  const onClick = useCallback(
    (e: MouseEvent<HTMLElement>) => {
      const started = startedOnBackdrop.current;
      startedOnBackdrop.current = false;
      if (!onDismiss || !started) return;
      if (e.target !== e.currentTarget) return;
      onDismiss();
    },
    [onDismiss],
  );

  return { onPointerDown, onClick };
}
