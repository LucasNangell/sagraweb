import { MousePointerClick, Unlink } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import type {
  AnaliseLabItem,
  AnaliseLabItemEscopo,
  AnaliseLabMark,
  UpdateAnaliseLabItemPayload,
  UpdateAnaliseLabMarkPayload,
} from "@/api/analiseLab";
import { AnaliseHtmlEditor } from "@/features/analise/components/AnaliseHtmlEditor";
import { AnaliseLabMarkCompactEditor } from "./AnaliseLabMarkCompactEditor";
import { labelTipo } from "./analiseLabLabels";
import {
  markScopeLabel,
  parsePageSpec,
  validatePageSpec,
} from "./analiseLabPageSpec";
import { AnaliseLabToolPalette } from "./AnaliseLabToolPalette";
import type { AnaliseLabTool } from "./AnaliseLabMarkTools";

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
  busy?: boolean;
  onSave: (payload: UpdateAnaliseLabItemPayload) => void;
  onClose: () => void;
  onDelete?: () => void;
  onUnlinkMark?: (markId: number) => void;
  onDeleteMark?: (markId: number) => void;
  /** Spec de páginas controlado pelo pai (modo de seleção por clique). */
  pageSpecOverride?: string | null;
  onPageSpecChange?: (spec: string) => void;
  pagePickActive?: boolean;
  onTogglePagePick?: (currentSpec: string) => void;
  allPagesSpec?: string;
  onPayloadChange?: (payload: UpdateAnaliseLabItemPayload) => void;
  /** Paleta de marcas abaixo do HTML. */
  tool?: AnaliseLabTool;
  onToolChange?: (tool: AnaliseLabTool) => void;
  markToolsSlot?: ReactNode;
  /** Editor compacto da marca selecionada (abaixo da paleta). */
  selectedMark?: AnaliseLabMark | null;
  markAllPagesSpec?: string;
  onUpdateMark?: (payload: UpdateAnaliseLabMarkPayload) => void;
  onDeleteSelectedMark?: () => void;
}

function buildPayload(args: {
  titulo: string;
  html: string;
  obs: string;
  componente: string;
  pageSpec: string;
  resolucaoObrigatoria: boolean;
  corrigidoSefoc: boolean;
  obsCorrecaoSefoc: string;
  isRegister: boolean;
  fallbackPagina: number;
}): UpdateAnaliseLabItemPayload {
  let pages: number[] = [];
  try {
    pages = args.pageSpec.trim() ? parsePageSpec(args.pageSpec) : [];
  } catch {
    pages = [];
  }
  const escopo: AnaliseLabItemEscopo =
    pages.length > 1 ? "paginas" : "pagina";
  const payload: UpdateAnaliseLabItemPayload = {
    titulo: args.titulo,
    html_snapshot: args.html,
    obs: args.obs || null,
    componente: args.componente,
    escopo,
    resolucao_obrigatoria: args.resolucaoObrigatoria,
    corrigido_sefoc: args.isRegister ? false : args.corrigidoSefoc,
    obs_correcao_sefoc:
      !args.isRegister && args.corrigidoSefoc
        ? args.obsCorrecaoSefoc || null
        : null,
  };
  if (escopo === "paginas") {
    payload.paginas = args.pageSpec;
    payload.pagina = 1;
  } else {
    payload.pagina = pages[0] || args.fallbackPagina || 1;
    payload.paginas = "";
  }
  return payload;
}

export function AnaliseLabItemPanel({
  item,
  mode = "edit",
  marks,
  busy,
  onSave,
  onClose,
  onDelete,
  onUnlinkMark,
  onDeleteMark,
  pageSpecOverride = null,
  onPageSpecChange,
  pagePickActive = false,
  onTogglePagePick,
  allPagesSpec = "",
  onPayloadChange,
  tool,
  onToolChange,
  markToolsSlot,
  selectedMark = null,
  markAllPagesSpec = "",
  onUpdateMark,
  onDeleteSelectedMark,
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

  const allPagesActive =
    Boolean(allPagesSpec) && pageSpec.trim() === allPagesSpec.trim();

  const pageError = useMemo(() => {
    if (pagePickActive && !pageSpec.trim()) return null;
    if (!pageSpec.trim()) return "Informe as páginas.";
    return validatePageSpec(pageSpec);
  }, [pageSpec, pagePickActive]);

  const linkedMarks = useMemo(
    () => (item.id == null ? [] : marks.filter((m) => m.itemId === item.id)),
    [item.id, marks],
  );

  useEffect(() => {
    if (!onPayloadChange) return;
    onPayloadChange(
      buildPayload({
        titulo,
        html,
        obs,
        componente,
        pageSpec,
        resolucaoObrigatoria,
        corrigidoSefoc,
        obsCorrecaoSefoc,
        isRegister,
        fallbackPagina: item.pagina || 1,
      }),
    );
  }, [
    onPayloadChange,
    titulo,
    html,
    obs,
    componente,
    pageSpec,
    resolucaoObrigatoria,
    corrigidoSefoc,
    obsCorrecaoSefoc,
    isRegister,
    item.pagina,
  ]);

  const pagePickButton = onTogglePagePick ? (
    <button
      type="button"
      title="Selecionar páginas clicando no documento"
      aria-label="Selecionar páginas clicando no documento"
      aria-pressed={pagePickActive}
      onClick={() => onTogglePagePick(pageSpec)}
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
    <aside className="flex w-[420px] max-w-[38vw] shrink-0 flex-col gap-2 overflow-y-auto border-r border-sagra-border bg-white p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase text-neutral-600">
          {isRegister ? "Novo problema" : "Problema"}
        </h2>
        <button type="button" className="text-xs text-neutral-500" onClick={onClose}>
          Fechar
        </button>
      </div>

      {/* Campos ocultos temporariamente — mantidos no estado / payload.
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
      */}

      <div className="flex flex-col gap-1 text-xs text-neutral-600">
        <span>Páginas</span>
        <div className="flex items-center gap-1">
          <input
            value={pageSpec}
            onChange={(e) => setPageSpec(e.target.value)}
            placeholder="1-15,20,23"
            disabled={allPagesActive}
            className="min-w-0 flex-1 rounded border border-sagra-border px-2 py-1.5 disabled:bg-neutral-50"
          />
          {pagePickButton}
          {allPagesSpec ? (
            <label className="flex shrink-0 items-center gap-1 text-[11px] text-neutral-700">
              <input
                type="checkbox"
                checked={allPagesActive}
                onChange={(e) => {
                  if (e.target.checked) {
                    setPageSpec(allPagesSpec);
                    if (pagePickActive) onTogglePagePick?.(pageSpec);
                  } else {
                    setPageSpec("");
                  }
                }}
              />
              Todas as páginas
            </label>
          ) : null}
        </div>
        {pagePickActive && !pageSpec.trim() ? (
          <span className="text-[11px] text-sky-700">
            Clique nas páginas do documento para incluir ou remover.
          </span>
        ) : null}
        {pagePickActive && pageSpec.trim() ? (
          <span className="text-[11px] text-sky-700">
            Clique nas páginas do documento para incluir ou remover.
          </span>
        ) : null}
        {pageError ? (
          <span className="text-[11px] text-sagra-danger">{pageError}</span>
        ) : null}
      </div>

      <div className="max-h-[40vh] overflow-auto rounded border border-sagra-border">
        <AnaliseHtmlEditor
          html={html}
          onChange={setHtml}
          readOnly={busy}
          itemTitulo={titulo}
        />
      </div>

      {tool != null && onToolChange ? (
        <div className="space-y-1.5 rounded border border-sagra-border bg-neutral-50 p-2">
          <h3 className="text-[11px] font-semibold uppercase text-neutral-600">
            Marcas
          </h3>
          <AnaliseLabToolPalette
            tool={tool}
            onToolChange={onToolChange}
            busy={busy}
          />
          {markToolsSlot}
          {selectedMark &&
          tool === "select" &&
          onUpdateMark &&
          onDeleteSelectedMark ? (
            <AnaliseLabMarkCompactEditor
              mark={selectedMark}
              allPagesSpec={markAllPagesSpec}
              busy={busy}
              onSave={onUpdateMark}
              onDelete={onDeleteSelectedMark}
            />
          ) : null}
        </div>
      ) : null}

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
          <h3 className="text-[11px] font-semibold uppercase text-neutral-600">
            Marca vinculada
          </h3>
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
                  {onUnlinkMark ? (
                    <button
                      type="button"
                      className="text-neutral-500 hover:text-neutral-800"
                      title="Desvincular"
                      disabled={busy}
                      onClick={() => onUnlinkMark(m.id)}
                    >
                      <Unlink className="size-3" aria-hidden />
                    </button>
                  ) : null}
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
          disabled={busy || Boolean(pageError) || !pageSpec.trim()}
          className="flex-1 rounded bg-secondary-blue px-2 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          onClick={() => {
            onSave(
              buildPayload({
                titulo,
                html,
                obs,
                componente,
                pageSpec,
                resolucaoObrigatoria,
                corrigidoSefoc,
                obsCorrecaoSefoc,
                isRegister,
                fallbackPagina: item.pagina || 1,
              }),
            );
          }}
        >
          {isRegister ? "Registrar" : "Salvar"}
        </button>
        {!isRegister && onDelete ? (
          <button
            type="button"
            disabled={busy}
            className="rounded border border-sagra-danger/40 px-2 py-1.5 text-xs text-sagra-danger"
            onClick={() => {
              if (
                window.confirm(
                  "Excluir este problema técnico e todas as marcas vinculadas?",
                )
              ) {
                onDelete();
              }
            }}
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
