import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { fetchProblemasPadrao } from "@/api/analise";
import type { ProblemaPadrao } from "@/features/analise/types";

interface AnaliseLabLibraryProps {
  busy?: boolean;
  onRegister: (problema: ProblemaPadrao) => void;
}

export function AnaliseLabLibrary({ busy, onRegister }: AnaliseLabLibraryProps) {
  const [search, setSearch] = useState("");
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
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar problema…"
        className="rounded border border-sagra-border px-2 py-1 text-xs"
      />
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
    </div>
  );
}
