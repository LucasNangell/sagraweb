import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Library } from "lucide-react";

import { fetchProblemasPadrao } from "@/api/analise";
import type { ProblemaPadrao } from "@/features/analise/types";

import { AnaliseLabLibraryManageModal } from "./AnaliseLabLibraryManageModal";

interface AnaliseLabLibraryProps {
  busy?: boolean;
  onRegister: (problema: ProblemaPadrao) => void;
}

export function AnaliseLabLibrary({ busy, onRegister }: AnaliseLabLibraryProps) {
  const [search, setSearch] = useState("");
  const [manageOpen, setManageOpen] = useState(false);
  const libraryQuery = useQuery({
    queryKey: ["problemas-padrao"],
    queryFn: fetchProblemasPadrao,
    staleTime: 60_000,
  });

  const filtered = useMemo(() => {
    const list = libraryQuery.data ?? [];
    const term = search.trim().toLowerCase();
    const sorted = [...list].sort((a, b) =>
      (a.TituloPT || "").localeCompare(b.TituloPT || "", "pt-BR"),
    );
    if (!term) return sorted;
    return sorted.filter((item) =>
      (item.TituloPT || "").toLowerCase().includes(term),
    );
  }, [libraryQuery.data, search]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      <h2 className="shrink-0 text-xs font-semibold uppercase text-neutral-600">
        Itens disponíveis
      </h2>
      <div className="flex shrink-0 items-center gap-1">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar problema…"
          className="min-w-0 flex-1 rounded border border-sagra-border px-2 py-1 text-xs"
        />
        <button
          type="button"
          title="Gerenciar biblioteca"
          aria-label="Gerenciar biblioteca"
          disabled={busy}
          onClick={() => setManageOpen(true)}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded border border-sagra-border bg-white text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
        >
          <Library className="size-4" aria-hidden />
        </button>
      </div>
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        {filtered.map((p) => (
          <li key={p.ID}>
            <button
              type="button"
              disabled={busy}
              title={p.TituloPT}
              onClick={() => onRegister(p)}
              className="w-full truncate rounded px-1.5 py-1 text-left text-xs text-neutral-700 hover:bg-primary-green/10 disabled:opacity-50"
            >
              {p.TituloPT}
            </button>
          </li>
        ))}
        {!filtered.length && !libraryQuery.isLoading ? (
          <li className="px-1 text-[11px] text-neutral-400">Nenhum resultado.</li>
        ) : null}
      </ul>
      <AnaliseLabLibraryManageModal
        open={manageOpen}
        onClose={() => setManageOpen(false)}
      />
    </div>
  );
}
