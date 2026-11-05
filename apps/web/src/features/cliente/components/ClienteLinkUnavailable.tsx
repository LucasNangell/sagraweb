import { AlertCircle, RefreshCw } from "lucide-react";
import { Link } from "@tanstack/react-router";

interface ClienteLinkUnavailableProps {
  title: string;
  message: string;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

export function ClienteLinkUnavailable({
  title,
  message,
  onRefresh,
  isRefreshing,
}: ClienteLinkUnavailableProps) {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-6 text-center shadow-sm">
      <AlertCircle className="mx-auto size-10 text-amber-600" aria-hidden />
      <h2 className="mt-3 text-lg font-bold text-secondary-blue">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-neutral-700">{message}</p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
        {onRefresh ? (
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="min-h-11 sagra-btn sagra-btn--outline sagra-btn--md !text-secondary-blue"
          >
            <RefreshCw
              className={`size-4 ${isRefreshing ? "motion-safe:animate-spin" : ""}`}
              aria-hidden
            />
            Atualizar dados
          </button>
        ) : null}
        <Link
          to="/cliente"
          className="min-h-11 sagra-btn sagra-btn--secondary sagra-btn--md"
        >
          Voltar ao painel
        </Link>
      </div>
    </div>
  );
}
