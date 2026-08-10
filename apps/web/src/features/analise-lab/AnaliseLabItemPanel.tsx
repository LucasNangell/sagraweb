import { Link2, Unlink } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type {
  AnaliseLabItem,
  AnaliseLabItemEscopo,
  AnaliseLabMark,
  UpdateAnaliseLabItemPayload,
} from "@/api/analiseLab";
import { AnaliseHtmlEditor } from "@/features/analise/components/AnaliseHtmlEditor";
import { labelTipo } from "./analiseLabLabels";
import { markScopeLabel, validatePageSpec } from "./analiseLabPageSpec";

interface AnaliseLabItemPanelProps {
  item: AnaliseLabItem;
  marks: AnaliseLabMark[];
  linkingActive: boolean;
  busy?: boolean;
  onSave: (payload: UpdateAnaliseLabItemPayload) => void;
  onClose: () => void;
  onDelete: () => void;
  onStartLinking: () => void;
  onStopLinking: () => void;
  onUnlinkMark: (markId: number) => void;
  onDeleteMark: (markId: number) => void;
}

export function AnaliseLabItemPanel({
  item,
  marks,
  linkingActive,
  busy,
  onSave,
  onClose,
  onDelete,
  onStartLinking,
  onStopLinking,
  onUnlinkMark,
  onDeleteMark,
}: AnaliseLabItemPanelProps) {
  const [titulo, setTitulo] = useState(item.titulo);
  const [html, setHtml] = useState(item.htmlSnapshot || "");
  const [obs, setObs] = useState(item.obs || "");
  const [escopo, setEscopo] = useState<AnaliseLabItemEscopo>(
    (item.escopo as AnaliseLabItemEscopo) || "pagina",
  );
  const [pageSpec, setPageSpec] = useState(
    item.paginas || (item.pagina > 0 ? String(item.pagina) : ""),
  );
  const [componente, setComponente] = useState(item.componente);

  useEffect(() => {
    setTitulo(item.titulo);
    setHtml(item.htmlSnapshot || "");
    setObs(item.obs || "");
    setEscopo((item.escopo as AnaliseLabItemEscopo) || "pagina");
    setPageSpec(item.paginas || (item.pagina > 0 ? String(item.pagina) : ""));
    setComponente(item.componente);
  }, [item]);

  const pageError = useMemo(() => {
    if (escopo !== "paginas") return null;
    return validatePageSpec(pageSpec);
  }, [escopo, pageSpec]);

  const linkedMarks = useMemo(
    () => marks.filter((m) => m.itemId === item.id),
    [item.id, marks],
  );

  return (
    <aside className="flex w-[544px] max-w-[45vw] shrink-0 flex-col gap-2 overflow-y-auto border-l border-sagra-border bg-white p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase text-neutral-600">Problema</h2>
        <button type="button" className="text-xs text-neutral-500" onClick={onClose}>
          Fechar
        </button>
      </div>

      <label className="flex flex-col gap-1 text-xs text-neutral-600">
        Título
        <input
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          className="rounded border border-sagra-border px-2 py-1.5"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-neutral-600">
        Componente
        <select
          value={componente}
          onChange={(e) => setComponente(e.target.value)}
          className="rounded border border-sagra-border px-2 py-1.5"
        >
          <option value="Capa">Capa</option>
          <option value="Miolo">Miolo</option>
          <option value="Arq. Único">Arq. Único</option>
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs text-neutral-600">
        Escopo
        <select
          value={escopo}
          onChange={(e) => setEscopo(e.target.value as AnaliseLabItemEscopo)}
          className="rounded border border-sagra-border px-2 py-1.5"
        >
          <option value="pagina">Página atual / única</option>
          <option value="paginas">Várias páginas</option>
          <option value="arquivo">Arquivo / componente inteiro</option>
        </select>
      </label>

      {escopo === "paginas" ? (
        <label className="flex flex-col gap-1 text-xs text-neutral-600">
          Páginas
          <input
            value={pageSpec}
            onChange={(e) => setPageSpec(e.target.value)}
            placeholder="1-15,20,23"
            className="rounded border border-sagra-border px-2 py-1.5"
          />
          {pageError ? (
            <span className="text-[11px] text-sagra-danger">{pageError}</span>
          ) : null}
        </label>
      ) : null}

      {escopo === "pagina" ? (
        <label className="flex flex-col gap-1 text-xs text-neutral-600">
          Página
          <input
            type="number"
            min={1}
            value={Number(pageSpec) || item.pagina || 1}
            onChange={(e) => setPageSpec(String(Number(e.target.value) || 1))}
            className="rounded border border-sagra-border px-2 py-1.5"
          />
        </label>
      ) : null}

      <div className="max-h-[60vh] overflow-auto rounded border border-sagra-border">
        <AnaliseHtmlEditor
          html={html}
          onChange={setHtml}
          readOnly={busy}
          itemTitulo={titulo}
        />
      </div>

      <label className="flex flex-col gap-1 text-xs text-neutral-600">
        Observação
        <textarea
          value={obs}
          onChange={(e) => setObs(e.target.value)}
          rows={2}
          className="rounded border border-sagra-border px-2 py-1.5"
        />
      </label>

      <div className="space-y-1.5 rounded border border-sagra-border bg-neutral-50 p-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[11px] font-semibold uppercase text-neutral-600">
            Marca vinculada
          </h3>
          {linkingActive ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-900"
              onClick={onStopLinking}
            >
              <Unlink className="size-3" aria-hidden />
              Concluir marcação
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              className="inline-flex items-center gap-1 rounded bg-secondary-blue px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
              onClick={onStartLinking}
            >
              <Link2 className="size-3" aria-hidden />
              Marcar no arquivo
            </button>
          )}
        </div>
        {linkingActive ? (
          <p className="text-[11px] text-amber-800">
            Próximas marcas serão vinculadas a este problema.
          </p>
        ) : null}
        {linkedMarks.length ? (
          <ul className="space-y-0.5 text-[11px]">
            {linkedMarks.map((m) => (
              <li
                key={m.id}
                className="flex items-center gap-1 rounded bg-white px-1 py-0.5"
              >
                <span className="min-w-0 flex-1 truncate">
                  {labelTipo(m.tipo)}
                  {m.rotulo ? ` · ${m.rotulo}` : ""}
                  {` · ${markScopeLabel(m)}`}
                </span>
                <button
                  type="button"
                  className="text-neutral-500 hover:text-neutral-800"
                  title="Desvincular"
                  disabled={busy}
                  onClick={() => onUnlinkMark(m.id)}
                >
                  <Unlink className="size-3" aria-hidden />
                </button>
                <button
                  type="button"
                  className="text-sagra-danger"
                  title="Excluir marca"
                  disabled={busy}
                  onClick={() => onDeleteMark(m.id)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11px] text-neutral-500">Nenhuma marca vinculada.</p>
        )}
      </div>

      <div className="flex gap-1">
        <button
          type="button"
          disabled={busy || Boolean(pageError)}
          className="flex-1 rounded bg-secondary-blue px-2 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          onClick={() => {
            const payload: UpdateAnaliseLabItemPayload = {
              titulo,
              html_snapshot: html,
              obs: obs || null,
              componente,
              escopo,
            };
            if (escopo === "arquivo") {
              payload.pagina = 0;
              payload.paginas = "";
            } else if (escopo === "paginas") {
              payload.paginas = pageSpec;
              payload.pagina = 1;
            } else {
              payload.pagina = Number(pageSpec) || item.pagina || 1;
              payload.paginas = "";
            }
            onSave(payload);
          }}
        >
          Salvar
        </button>
        <button
          type="button"
          disabled={busy}
          className="rounded border border-sagra-danger/40 px-2 py-1.5 text-xs text-sagra-danger"
          onClick={onDelete}
        >
          Excluir
        </button>
      </div>
    </aside>
  );
}
