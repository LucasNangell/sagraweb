import { Trash2 } from "lucide-react";
import { useMemo } from "react";

import type { AnaliseLabItem } from "@/api/analiseLab";
import { markScopeLabel } from "./analiseLabPageSpec";

interface AnaliseLabItemListProps {
  items: AnaliseLabItem[];
  currentVersaoLabel?: string;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onDelete?: (id: number) => void;
  busy?: boolean;
}

export function AnaliseLabItemList({
  items,
  currentVersaoLabel = "",
  selectedId,
  onSelect,
  onDelete,
  busy,
}: AnaliseLabItemListProps) {
  const tree = useMemo(() => {
    const byVersao = new Map<string, Map<string, AnaliseLabItem[]>>();
    for (const item of items) {
      const v = item.versaoLabel || "(sem versão)";
      const c = item.componente || "Outros";
      if (!byVersao.has(v)) byVersao.set(v, new Map());
      const byComp = byVersao.get(v)!;
      if (!byComp.has(c)) byComp.set(c, []);
      byComp.get(c)!.push(item);
    }
    return byVersao;
  }, [items]);

  return (
    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto text-xs">
      {[...tree.entries()].map(([versao, byComp]) => {
        const readonly =
          Boolean(currentVersaoLabel) &&
          versao !== currentVersaoLabel &&
          versao !== "(sem versão)";
        return (
          <div key={versao}>
            <div className="mb-0.5 font-semibold uppercase tracking-wide text-neutral-500">
              {versao}
              {readonly ? " · leitura" : ""}
            </div>
            {[...byComp.entries()].map(([comp, list]) => (
              <div key={comp} className="mb-1 pl-1">
                <div className="text-[11px] font-medium text-neutral-600">{comp}</div>
                <ul className="space-y-0.5">
                  {list.map((item) => (
                    <li
                      key={item.id}
                      className={
                        selectedId === item.id
                          ? "flex items-center gap-1 rounded border border-primary-green bg-primary-green/5 px-1 py-0.5"
                          : "flex items-center gap-1 rounded border border-transparent px-1 py-0.5 hover:bg-neutral-50"
                      }
                    >
                      <button
                        type="button"
                        className="min-w-0 flex-1 truncate text-left"
                        onClick={() => onSelect(item.id)}
                      >
                        {item.titulo}
                        <span className="ml-1 text-neutral-400">
                          · {markScopeLabel(item)}
                        </span>
                      </button>
                      {onDelete && !readonly ? (
                        <button
                          type="button"
                          disabled={busy}
                          className="shrink-0 text-sagra-danger"
                          onClick={() => onDelete(item.id)}
                          title="Excluir"
                        >
                          <Trash2 className="size-3" aria-hidden />
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        );
      })}
      {!items.length ? (
        <p className="text-neutral-400">Nenhum problema registrado.</p>
      ) : null}
    </div>
  );
}
