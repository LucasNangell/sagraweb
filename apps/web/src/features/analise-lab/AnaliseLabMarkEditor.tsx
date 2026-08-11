import { useEffect, useMemo, useState } from "react";

import type {
  AnaliseLabEdge,
  AnaliseLabMark,
  AnaliseLabMarkCor,
  UpdateAnaliseLabMarkPayload,
} from "@/api/analiseLab";
import { distanceMm, formatMm } from "./analiseLabGeometry";
import {
  COLOR_OPTIONS,
  EDGE_OPTIONS,
  EDGE_OPTIONS_SANGRIA,
  labelCor,
  labelEdge,
  labelTipo,
} from "./analiseLabLabels";
import { parsePageSpec, validatePageSpec } from "./analiseLabPageSpec";

interface AnaliseLabMarkEditorProps {
  mark: AnaliseLabMark;
  busy?: boolean;
  onSave: (payload: UpdateAnaliseLabMarkPayload) => void;
  onCancel: () => void;
  onDelete: () => void;
}

export function AnaliseLabMarkEditor({
  mark,
  busy = false,
  onSave,
  onCancel,
  onDelete,
}: AnaliseLabMarkEditorProps) {
  const [allPages, setAllPages] = useState(
    !mark.paginas?.trim() && mark.pagina === 0,
  );
  const [pageSpec, setPageSpec] = useState(
    mark.paginas?.trim()
      ? mark.paginas
      : mark.pagina > 0
        ? String(mark.pagina)
        : "",
  );
  const [cor, setCor] = useState(mark.cor as AnaliseLabMarkCor);
  const [rotulo, setRotulo] = useState(mark.rotulo || "");
  const [espelhar, setEspelhar] = useState(Boolean(mark.espelhar));
  const [paginaOrigem, setPaginaOrigem] = useState(mark.paginaOrigem || 1);
  const [geom, setGeom] = useState<Record<string, number | string>>({
    ...mark.geometria,
  });

  useEffect(() => {
    setAllPages(!mark.paginas?.trim() && mark.pagina === 0);
    setPageSpec(
      mark.paginas?.trim()
        ? mark.paginas
        : mark.pagina > 0
          ? String(mark.pagina)
          : "",
    );
    setCor(mark.cor as AnaliseLabMarkCor);
    setRotulo(mark.rotulo || "");
    setEspelhar(Boolean(mark.espelhar));
    setPaginaOrigem(mark.paginaOrigem || 1);
    setGeom({ ...mark.geometria });
  }, [mark]);

  const pageSpecError = useMemo(() => {
    if (allPages) return null;
    return validatePageSpec(pageSpec);
  }, [allPages, pageSpec]);

  const showMirror = useMemo(() => {
    if (
      mark.tipo !== "offset_corte" &&
      mark.tipo !== "faixa" &&
      mark.tipo !== "sangria" &&
      mark.tipo !== "retangulo"
    ) {
      return false;
    }
    if (allPages) return true;
    if (pageSpecError) return false;
    try {
      return parsePageSpec(pageSpec).length > 1;
    } catch {
      return false;
    }
  }, [allPages, mark.tipo, pageSpec, pageSpecError]);

  const setNum = (key: string, value: number) => {
    setGeom((g) => ({ ...g, [key]: value }));
  };

  const medidaDist =
    mark.tipo === "medida"
      ? distanceMm(
          Number(geom.x1Mm) || 0,
          Number(geom.y1Mm) || 0,
          Number(geom.x2Mm) || 0,
          Number(geom.y2Mm) || 0,
        )
      : null;

  return (
    <div className="space-y-2 rounded border border-primary-green/40 bg-primary-green/5 p-2">
      <h3 className="text-xs font-semibold text-neutral-700">
        Editar · {labelTipo(mark.tipo)}
      </h3>

      {(mark.tipo === "offset_corte" || mark.tipo === "faixa") && (
        <>
          <label className="flex flex-col gap-1 text-xs text-neutral-600">
            Borda
            <select
              value={String(geom.edge || "top")}
              onChange={(e) =>
                setGeom((g) => ({ ...g, edge: e.target.value as AnaliseLabEdge }))
              }
              className="rounded border border-sagra-border px-2 py-1.5"
            >
              {EDGE_OPTIONS.map((e) => (
                <option key={e} value={e}>
                  {labelEdge(e)}
                </option>
              ))}
            </select>
          </label>
          {mark.tipo === "offset_corte" ? (
            <label className="flex flex-col gap-1 text-xs text-neutral-600">
              Offset (mm)
              <input
                type="number"
                min={0}
                step={0.5}
                value={Number(geom.offsetMm) || 0}
                onChange={(e) => setNum("offsetMm", Number(e.target.value) || 0)}
                className="rounded border border-sagra-border px-2 py-1.5"
              />
            </label>
          ) : (
            <>
              <label className="flex flex-col gap-1 text-xs text-neutral-600">
                De (mm)
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={Number(geom.fromMm) || 0}
                  onChange={(e) => setNum("fromMm", Number(e.target.value) || 0)}
                  className="rounded border border-sagra-border px-2 py-1.5"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-neutral-600">
                Até (mm)
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={Number(geom.toMm) || 0}
                  onChange={(e) => setNum("toMm", Number(e.target.value) || 0)}
                  className="rounded border border-sagra-border px-2 py-1.5"
                />
              </label>
            </>
          )}
        </>
      )}

      {mark.tipo === "sangria" && (
        <>
          <label className="flex flex-col gap-1 text-xs text-neutral-600">
            Borda
            <select
              value={String(geom.edge || "left")}
              onChange={(e) =>
                setGeom((g) => ({ ...g, edge: e.target.value as AnaliseLabEdge }))
              }
              className="rounded border border-sagra-border px-2 py-1.5"
            >
              {EDGE_OPTIONS_SANGRIA.map((e) => (
                <option key={e} value={e}>
                  {labelEdge(e)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-neutral-600">
            Profundidade (mm)
            <input
              type="number"
              min={0.5}
              max={50}
              step={0.5}
              value={Math.abs(Number(geom.fromMm) || 0)}
              onChange={(e) => {
                const depth = Math.max(0.5, Number(e.target.value) || 5);
                setGeom((g) => ({ ...g, fromMm: -depth, toMm: 0 }));
              }}
              className="rounded border border-sagra-border px-2 py-1.5"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-neutral-600">
            Trecho início (mm)
            <input
              type="number"
              step={0.5}
              value={Number(geom.alongFromMm) || 0}
              onChange={(e) =>
                setNum("alongFromMm", Number(e.target.value) || 0)
              }
              className="rounded border border-sagra-border px-2 py-1.5"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-neutral-600">
            Trecho fim (mm)
            <input
              type="number"
              step={0.5}
              value={Number(geom.alongToMm) || 0}
              onChange={(e) => setNum("alongToMm", Number(e.target.value) || 0)}
              className="rounded border border-sagra-border px-2 py-1.5"
            />
          </label>
        </>
      )}

      {mark.tipo === "retangulo" && (
        <div className="grid grid-cols-2 gap-2">
          {(["xMm", "yMm", "wMm", "hMm"] as const).map((k) => (
            <label key={k} className="flex flex-col gap-1 text-xs text-neutral-600">
              {k.replace("Mm", " (mm)")}
              <input
                type="number"
                step={0.5}
                value={Number(geom[k]) || 0}
                onChange={(e) => setNum(k, Number(e.target.value) || 0)}
                className="rounded border border-sagra-border px-2 py-1.5"
              />
            </label>
          ))}
        </div>
      )}

      {mark.tipo === "ponto" && (
        <div className="grid grid-cols-2 gap-2">
          {(["xMm", "yMm"] as const).map((k) => (
            <label key={k} className="flex flex-col gap-1 text-xs text-neutral-600">
              {k.replace("Mm", " (mm)")}
              <input
                type="number"
                step={0.5}
                value={Number(geom[k]) || 0}
                onChange={(e) => setNum(k, Number(e.target.value) || 0)}
                className="rounded border border-sagra-border px-2 py-1.5"
              />
            </label>
          ))}
        </div>
      )}

      {mark.tipo === "medida" && (
        <>
          <div className="grid grid-cols-2 gap-2">
            {(["x1Mm", "y1Mm", "x2Mm", "y2Mm"] as const).map((k) => (
              <label key={k} className="flex flex-col gap-1 text-xs text-neutral-600">
                {k.replace("Mm", " (mm)")}
                <input
                  type="number"
                  step={0.5}
                  value={Number(geom[k]) || 0}
                  onChange={(e) => setNum(k, Number(e.target.value) || 0)}
                  className="rounded border border-sagra-border px-2 py-1.5"
                />
              </label>
            ))}
          </div>
          <p className="text-xs font-medium text-neutral-700">
            Distância: {formatMm(medidaDist || 0)}
          </p>
        </>
      )}

      {mark.tipo === "grade" && (
        <label className="flex flex-col gap-1 text-xs text-neutral-600">
          Passo (mm)
          <input
            type="number"
            min={1}
            max={50}
            step={1}
            value={Number(geom.stepMm) || 10}
            onChange={(e) => setNum("stepMm", Number(e.target.value) || 10)}
            className="rounded border border-sagra-border px-2 py-1.5"
          />
        </label>
      )}

      <label className="flex items-center gap-2 text-xs text-neutral-700">
        <input
          type="checkbox"
          checked={allPages}
          onChange={(e) => setAllPages(e.target.checked)}
        />
        Todas as páginas
      </label>

      {!allPages ? (
        <label className="flex flex-col gap-1 text-xs text-neutral-600">
          Páginas
          <input
            value={pageSpec}
            onChange={(e) => setPageSpec(e.target.value)}
            className={
              pageSpecError
                ? "rounded border border-sagra-danger px-2 py-1.5"
                : "rounded border border-sagra-border px-2 py-1.5"
            }
            placeholder="1-15,20,23,25-30"
          />
          {pageSpecError ? (
            <span className="text-[11px] text-sagra-danger">{pageSpecError}</span>
          ) : null}
        </label>
      ) : null}

      <label className="flex flex-col gap-1 text-xs text-neutral-600">
        Cor
        <select
          value={cor}
          onChange={(e) => setCor(e.target.value as AnaliseLabMarkCor)}
          className="rounded border border-sagra-border px-2 py-1.5"
        >
          {COLOR_OPTIONS.map((c) => (
            <option key={c} value={c}>
              {labelCor(c)}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs text-neutral-600">
        Rótulo
        <input
          value={rotulo}
          maxLength={120}
          onChange={(e) => setRotulo(e.target.value)}
          className="rounded border border-sagra-border px-2 py-1.5"
        />
      </label>

      {showMirror ? (
        <>
          <label className="flex items-center gap-2 text-xs text-neutral-700">
            <input
              type="checkbox"
              checked={espelhar}
              onChange={(e) => setEspelhar(e.target.checked)}
            />
            Espelhar em páginas opostas
          </label>
          <label className="flex flex-col gap-1 text-xs text-neutral-600">
            Página de origem (paridade)
            <input
              type="number"
              min={1}
              step={1}
              value={paginaOrigem}
              onChange={(e) => setPaginaOrigem(Number(e.target.value) || 1)}
              className="rounded border border-sagra-border px-2 py-1.5"
            />
          </label>
        </>
      ) : null}

      <div className="flex gap-1 pt-1">
        <button
          type="button"
          disabled={busy || Boolean(pageSpecError)}
          onClick={() => {
            if (allPages) {
              onSave({
                pagina: 0,
                paginas: "",
                geometria: geom,
                rotulo: rotulo || null,
                cor,
                espelhar,
                pagina_origem: paginaOrigem,
              });
              return;
            }
            const pages = parsePageSpec(pageSpec);
            onSave({
              pagina: pages[0],
              paginas: pageSpec,
              geometria: geom,
              rotulo: rotulo || null,
              cor,
              espelhar,
              pagina_origem: paginaOrigem,
            });
          }}
          className="flex-1 rounded bg-secondary-blue px-2 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          Salvar
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="rounded border border-sagra-border px-2 py-1.5 text-xs"
        >
          Cancelar
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onDelete}
          className="rounded border border-sagra-danger/40 px-2 py-1.5 text-xs text-sagra-danger"
        >
          Excluir
        </button>
      </div>
    </div>
  );
}
