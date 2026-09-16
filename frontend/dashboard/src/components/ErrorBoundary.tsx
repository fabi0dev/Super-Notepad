import { Component, type ErrorInfo, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { cardClass } from "@/components/ui/card";

type ErrorBoundaryProps = {
  children: ReactNode;
  resetKeys?: Array<string | number | null | undefined>;
};

type ErrorBoundaryState = {
  hasError: boolean;
  message: string;
};

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = {
    hasError: false,
    message: "",
  };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : "Erro desconhecido",
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error("Dashboard ErrorBoundary capturou um erro", error, info);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (!this.state.hasError) return;
    const prev = prevProps.resetKeys ?? [];
    const next = this.props.resetKeys ?? [];
    if (prev.length !== next.length) {
      this.setState({ hasError: false, message: "" });
      return;
    }
    for (let i = 0; i < prev.length; i += 1) {
      if (prev[i] !== next[i]) {
        this.setState({ hasError: false, message: "" });
        return;
      }
    }
  }

  private readonly handleReload = (): void => {
    window.location.reload();
  };

  private readonly handleGoChat = (): void => {
    window.location.assign("/chat");
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="flex h-dvh items-center justify-center bg-background px-4 text-foreground">
        <div className={cn(cardClass, "w-full max-w-xl p-6")}>
          <h1 className="text-lg font-semibold">Algo correu mal</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            A aplicação encontrou um erro inesperado. Pode recarregar a página
            ou voltar ao chat para continuar.
          </p>
          <p className="mt-2 rounded-md bg-(--chat-code-bg) px-3 py-2 text-xs text-muted-foreground">
            {this.state.message}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={this.handleReload}
              className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:opacity-90"
            >
              Recarregar
            </button>
            <button
              type="button"
              onClick={this.handleGoChat}
              className="rounded-md border border-(--border-color) px-3 py-2 text-sm text-foreground hover:bg-(--surface-hover)"
            >
              Voltar ao chat
            </button>
          </div>
        </div>
      </div>
    );
  }
}
