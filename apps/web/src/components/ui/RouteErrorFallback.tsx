import type { ErrorComponentProps } from "@tanstack/react-router";

export function RouteErrorFallback({ error, reset }: ErrorComponentProps) {
  const message =
    error instanceof Error ? error.message : "Erro desconhecido ao carregar a página.";

  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center gap-4 rounded-lg border border-sagra-danger/30 bg-red-50 p-6 text-center">
      <h2 className="text-lg font-semibold text-sagra-danger">
        Falha ao renderizar a página
      </h2>
      <p className="max-w-lg text-sm text-neutral-700">{message}</p>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded bg-secondary-blue px-4 py-2 text-sm font-semibold text-white"
        >
          Tentar novamente
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded border border-sagra-border px-4 py-2 text-sm"
        >
          Recarregar (Ctrl+F5)
        </button>
      </div>
    </div>
  );
}
