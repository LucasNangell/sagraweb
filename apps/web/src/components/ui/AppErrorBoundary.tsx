import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[AppErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-sagra-bg p-6 text-center">
          <h1 className="text-lg font-semibold text-sagra-danger">
            Erro na interface
          </h1>
          <p className="max-w-lg text-sm text-neutral-700">
            {this.state.error.message}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded bg-primary-green px-4 py-2 text-sm font-semibold text-white"
          >
            Recarregar página
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
