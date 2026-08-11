import { Link2, MousePointerClick, Unlink } from "lucide-react";
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

export type AnaliseLabItemPanelMode = "edit" | "register";

export interface AnaliseLabItemPanelModel {
  id?: number;
  titulo: string;
  htmlSnapshot: string;
  obs?: string | null;
  componente: string;
  escopo: AnaliseLabItemEscopo | string;
  pagina: number;
  paginas?: string | null;
  resolucaoObrigatoria?: boolean;
  corrigidoSefoc?: boolean;
  obsCorrecaoSefoc?: string | null;
  idProblemaPadrao?: number | null;
}

interface AnaliseLabItemPanelProps {
  item: AnaliseLabItemPanelModel;
  mode?: AnaliseLabItemPanelMode;
  marks: AnaliseLabMark[];
  linkingActive: boolean;
  busy?: boolean;
  onSave: (payload: UpdateAnaliseLabItemPayload) => void;
  onClose: () => void;
  onDelete?: () => void;
  onStartLinking?: () => void;
  onStopLinking?: () => void;
  onUnlinkMark?: (markId: number) => void;
  onDeleteMark?: (markId: number) => void;
  /** Spec de páginas controlado pelo pai (modo de seleção por clique). */
  pageSpecOverride?: string | null;
  onPageSpecChange?: (spec: string) => void;
  pagePickActive?: boolean;
  onTogglePagePick?: (currentSpec: string) => void;
}

export function AnaliseLabItemPanel({
  item,
  mode = "edit",
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
  pageSpecOverride = null,
  onPageSpecChange,
  pagePickActive = false,
  onTogglePagePick,
}: AnaliseLabItemPanelProps) {
  const isRegister = mode === "register";
  const [titulo, setTitulo] = useState(item.titulo);
  const [html, setHtml] = useState(item.htmlSnapshot || "");
  const [obs, setObs] = useState(item.obs || "");
  const [escopo, setEscopo] = useState<AnaliseLabItemEscopo>(
    (item.escopo as AnaliseLabItemEscopo) || "pagina",
  );
  const [localPageSpec, setLocalPageSpec] = useState(
    item.paginas || (item.pagina > 0 ? String(item.pagina) : ""),
  );
  const pageSpec = pageSpecOverride ?? localPageSpec;
  const setPageSpec = (value: string) => {
    setLocalPageSpec(value);
    onPageSpecChange?.(value);
  };
  const [componente, setComponente] = useState(item.componente);
  const [resolucaoObrigatoria, setResolucaoObrigatoria] = useState(
    Boolean(item.resolucaoObrigatoria),
  );
  const [corrigidoSefoc, setCorrigidoSefoc] = useState(
    Boolean(item.corrigidoSefoc),
  );
  const [obsCorrecaoSefoc, setObsCorrecaoSefoc] = useState(
    item.obsCorrecaoSefoc || "",
  );

  useEffect(() => {
    setTitulo(item.titulo);
    setHtml(item.htmlSnapshot || "");
    setObs(item.obs || "");
    setEscopo((item.escopo as AnaliseLabItemEscopo) || "pagina");
    setLocalPageSpec(
      item.paginas || (item.pagina > 0 ? String(item.pagina) : ""),
    );
    setComponente(item.componente);
    setResolucaoObrigatoria(Boolean(item.resolucaoObrigatoria));
    setCorrigidoSefoc(Boolean(item.corrigidoSefoc));
    setObsCorrecaoSefoc(item.obsCorrecaoSefoc || "");
  }, [item]);

  const pageError = useMemo(() => {
    if (escopo !== "paginas") return null;
    return validatePageSpec(pageSpec);
  }, [escopo, pageSpec]);

  const linkedMarks = useMemo(
    () => (item.id == null ? [] : marks.filter((m) => m.itemId === item.id)),
    [item.id, marks],
  );

  const pagePickButton = onTogglePagePick ? (
    <button
      type="button"
      title="Selecionar páginas clicando no documento"
      aria-label="Selecionar páginas clicando no documento"
      aria-pressed={pagePickActive}
      onClick={() => {
        if (!pagePickActive && escopo !== "paginas") setEscopo("paginas");
        onTogglePagePick(pageSpec);
      }}
      className={
        pagePickActive
          ? "inline-flex size-8 shrink-0 items-center justify-center rounded border border-sky-500 bg-sky-50 text-sky-700"
          : "inline-flex size-8 shrink-0 items-center justify-center rounded border border-sagra-border bg-white text-neutral-600 hover:bg-neutral-50"
      }
    >
      <MousePointerClick className="size-4" aria-hidden />
    </button>
  ) : null;

  return (
    <aside className="flex w-[544px] max-w-[45vw] shrink-0 flex-col gap-2 overflow-y-auto border-l border-sagra-border bg-white p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase text-neutral-600">
          {isRegister ? "Novo problema" : "Problema"}
        </h2>
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
        <div className="flex flex-col gap-1 text-xs text-neutral-600">
          <span>Páginas</span>
          <div className="flex items-center gap-1">
            <input
              value={pageSpec}
              onChange={(e) => setPageSpec(e.target.value)}
              placeholder="1-15,20,23"
              className="min-w-0 flex-1 rounded border border-sagra-border px-2 py-1.5"
            />
            {pagePickButton}
          </div>
          {pagePickActive ? (
            <span className="text-[11px] text-sky-700">
              Clique nas páginas do documento para incluir ou remover.
            </span>
          ) : null}
          {pageError ? (
            <span className="text-[11px] text-sagra-danger">{pageError}</span>
          ) : null}
        </div>
      ) : null}

      {escopo === "pagina" ? (
        <div className="flex flex-col gap-1 text-xs text-neutral-600">
          <span>Página</span>
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={1}
              value={Number(pageSpec) || item.pagina || 1}
              onChange={(e) => setPageSpec(String(Number(e.target.value) || 1))}
              className="min-w-0 flex-1 rounded border border-sagra-border px-2 py-1.5"
            />
            {pagePickButton}
          </div>
        </div>
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

      <div className="space-y-2 rounded border border-sagra-border bg-neutral-50 p-2 text-xs">
        <label className="flex items-center gap-2 text-neutral-700">
          <input
            type="checkbox"
            checked={resolucaoObrigatoria}
            onChange={(e) => setResolucaoObrigatoria(e.target.checked)}
            disabled={busy}
          />
          Resolução obrigatória
        </label>
        {!isRegister ? (
          <>
            <label className="flex items-center gap-2 text-neutral-700">
              <input
                type="checkbox"
                checked={corrigidoSefoc}
                onChange={(e) => setCorrigidoSefoc(e.target.checked)}
                disabled={busy}
              />
              Corrigido (controle interno)
            </label>
            {corrigidoSefoc ? (
              <label className="flex flex-col gap-1 text-neutral-600">
                Observação da correção (interno)
                <textarea
                  value={obsCorrecaoSefoc}
                  onChange={(e) => setObsCorrecaoSefoc(e.target.value)}
                  rows={2}
                  className="rounded border border-sagra-border bg-white px-2 py-1.5"
                  disabled={busy}
                />
              </label>
            ) : null}
          </>
        ) : null}
      </div>

      {!isRegister ? (
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
                    onClick={() => onUnlinkMark?.(m.id)}
                  >
                    <Unlink className="size-3" aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="text-sagra-danger"
                    title="Excluir marca"
                    disabled={busy}
                    onClick={() => onDeleteMark?.(m.id)}
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
      ) : null}

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
              resolucao_obrigatoria: resolucaoObrigatoria,
              corrigido_sefoc: isRegister ? false : corrigidoSefoc,
              obs_correcao_sefoc:
                !isRegister && corrigidoSefoc
                  ? obsCorrecaoSefoc || null
                  : null,
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
          {isRegister ? "Registrar" : "Salvar"}
        </button>
        {!isRegister && onDelete ? (
          <button
            type="button"
            disabled={busy}
            className="rounded border border-sagra-danger/40 px-2 py-1.5 text-xs text-sagra-danger"
            onClick={onDelete}
          >
            Excluir
          </button>
        ) : null}
      </div>
    </aside>
  );
}

export function toPanelModel(item: AnaliseLabItem): AnaliseLabItemPanelModel {
  return {
    id: item.id,
    titulo: item.titulo,
    htmlSnapshot: item.htmlSnapshot,
    obs: item.obs,
    componente: item.componente,
    escopo: item.escopo,
    pagina: item.pagina,
    paginas: item.paginas,
    resolucaoObrigatoria: item.resolucaoObrigatoria,
    corrigidoSefoc: item.corrigidoSefoc,
    obsCorrecaoSefoc: item.obsCorrecaoSefoc,
    idProblemaPadrao: item.idProblemaPadrao,
  };
}
