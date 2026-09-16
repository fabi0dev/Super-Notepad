import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useBackdropDismiss } from "./useBackdropDismiss";

afterEach(cleanup);

function Dialogo({ onDismiss }: { onDismiss: () => void }) {
  const backdrop = useBackdropDismiss(onDismiss);
  return (
    <div data-testid="backdrop" {...backdrop}>
      <div data-testid="painel">
        <p data-testid="texto">texto selecionável</p>
      </div>
    </div>
  );
}

/**
 * O `click` do DOM dispara no ancestral COMUM do mousedown e do mouseup.
 * Selecionar dentro do painel e soltar fora torna o backdrop esse ancestral,
 * então um handler que só olha `e.target` fecha no meio da seleção.
 */
function selecionarArrastandoParaFora() {
  const texto = screen.getByTestId("texto");
  const backdrop = screen.getByTestId("backdrop");
  fireEvent.pointerDown(texto);
  fireEvent.pointerUp(backdrop);
  // O clique resultante tem o backdrop como alvo — é isso que enganava.
  fireEvent.click(backdrop);
}

describe("useBackdropDismiss", () => {
  it("não fecha quando a seleção começou dentro do painel", () => {
    const onDismiss = vi.fn();
    render(<Dialogo onDismiss={onDismiss} />);

    selecionarArrastandoParaFora();

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("fecha no clique que começa e termina no backdrop", () => {
    const onDismiss = vi.fn();
    render(<Dialogo onDismiss={onDismiss} />);

    const backdrop = screen.getByTestId("backdrop");
    fireEvent.pointerDown(backdrop);
    fireEvent.click(backdrop);

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("não fecha em clique dentro do painel", () => {
    const onDismiss = vi.fn();
    render(<Dialogo onDismiss={onDismiss} />);

    const painel = screen.getByTestId("painel");
    fireEvent.pointerDown(painel);
    fireEvent.click(painel);

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("o estado não vaza para a interação seguinte", () => {
    // Sem zerar a flag, uma seleção abortada deixaria o próximo clique no
    // painel fechando o diálogo.
    const onDismiss = vi.fn();
    render(<Dialogo onDismiss={onDismiss} />);
    const backdrop = screen.getByTestId("backdrop");

    fireEvent.pointerDown(backdrop);
    fireEvent.click(backdrop);
    expect(onDismiss).toHaveBeenCalledTimes(1);

    selecionarArrastandoParaFora();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("sem onDismiss, nada acontece", () => {
    render(<Dialogo onDismiss={undefined as unknown as () => void} />);
    const backdrop = screen.getByTestId("backdrop");
    expect(() => {
      fireEvent.pointerDown(backdrop);
      fireEvent.click(backdrop);
    }).not.toThrow();
  });
});
