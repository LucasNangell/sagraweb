import { Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type {
  AnaliseLabEdge,
  AnaliseLabMark,
  AnaliseLabMarkCor,
  UpdateAnaliseLabMarkPayload,
} from "@/api/analiseLab";

import {
  EDGE_OPTIONS,
  EDGE_OPTIONS_SANGRIA,
  labelEdge,
  labelTipo,
} from "./analiseLabLabels";
import { markCorToHex, nearestMarkCor } from "./analiseLabMarkColor";
import { parsePageSpec, validatePageSpec } from "./analiseLabPageSpec";

const inputClass =
  "h-7 rounded border border-sagra-border bg-white px-1.5 text-[11px]";
const colorSwatchClass =
  "h-7 w-7 cursor-pointer rounded border border-sagra-border bg-white p-0.5";

interface AnaliseLabMarkCompactEditorProps {
  mark: AnaliseLabMark;
  allPagesSpec: string;
  busy?: boolean;
  onSave: (payload: UpdateAnaliseLabMarkPayload) => void;
  onDelete: () => void;
}

function canEspelharTipo(tipo: string): boolean {
  return (
    tipo === "offset_corte" ||
    tipo === "faixa" ||
    tipo === "sangria" ||
    tipo === "retangulo" ||
    tipo === "seta" ||
    tipo === "circulo" ||
    tipo === "texto"
  );
}

function buildPayload(args: {
  mark: AnaliseLabMark;
  allPages: boolean;
  allPagesSpec: string;
  pageSpec: string;
  cor: AnaliseLabMarkCor;
  rotulo: string;
  espelhar: boolean;
  geom: Record<string, number | string>;
}): UpdateAnaliseLabMarkPayload | null {
  const {
    mark,
    allPages,
    allPagesSpec,
    pageSpec,
    cor,
    rotulo,
    espelhar,
    geom,
  } = args;

  let paginas: string;
  let pagina: number;
  if (allPages) {
    if (!allPagesSpec.trim()) return null;
    try {
      parsePageSpec(allPagesSpec);
    } catch {
      return null;
    }
    paginas = allPagesSpec;
    pagina = 1;
  } else {
    if (validatePageSpec(pageSpec)) return null;
    const pages = parsePageSpec(pageSpec);
    pagina = pages[0] ?? mark.paginaOrigem ?? 1;
    paginas = pageSpec;
  }

  let multi = false;
  try {
    multi = parsePageSpec(paginas).length > 1;
  } catch {
    multi = false;
  }

  return {
    pagina,
    paginas,
    geometria: geom,
    rotulo: rotulo || null,
    cor,
    espelhar: canEspelharTipo(mark.tipo) && espelhar && multi,
  };
}

export function AnaliseLabMarkCompactEditor({
  mark,
  allPagesSpec,
  busy = false,
  onSave,
  onDelete,
}: AnaliseLabMarkCompactEditorProps) {
  const initialSpec =
    mark.paginas?.trim() ||
    (mark.pagina > 0 ? String(mark.pagina) : String(mark.paginaOrigem || 1));
  const [allPages, setAllPages] = useState(
    Boolean(
      allPagesSpec &&
        mark.paginas?.trim() &&
        mark.paginas.trim() === allPagesSpec.trim(),
    ),
  );
  const [pageSpec, setPageSpec] = useState(initialSpec);
  const [savedSpec, setSavedSpec] = useState(initialSpec);
  const [cor, setCor] = useState(mark.cor as AnaliseLabMarkCor);
  const [rotulo, setRotulo] = useState(mark.rotulo || "");
  const [espelhar, setEspelhar] = useState(Boolean(mark.espelhar));
  const [geom, setGeom] = useState<Record<string, number | string>>({
    ...mark.geometria,
  });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipFirst = useRef(true);

  useEffect(() => {
    const spec =
      mark.paginas?.trim() ||
      (mark.pagina > 0 ? String(mark.pagina) : String(mark.paginaOrigem || 1));
    setPageSpec(spec);
    setSavedSpec(spec);
    setAllPages(
      Boolean(
        allPagesSpec &&
          mark.paginas?.trim() &&
          mark.paginas.trim() === allPagesSpec.trim(),
      ),
    );
    setCor(mark.cor as AnaliseLabMarkCor);
    setRotulo(mark.rotulo || "");
    setEspelhar(Boolean(mark.espelhar));
    setGeom({ ...mark.geometria });
    skipFirst.current = true;
  }, [mark, allPagesSpec]);

  const pageSpecError = useMemo(() => {
    if (allPages) return null;
    return validatePageSpec(pageSpec);
  }, [allPages, pageSpec]);

  const showMirror = useMemo(() => {
    if (!canEspelharTipo(mark.tipo)) return false;
    if (allPages) return Boolean(allPagesSpec);
    if (pageSpecError) return false;
    try {
      return parsePageSpec(pageSpec).length > 1;
    } catch {
      return false;
    }
  }, [allPages, allPagesSpec, mark.tipo, pageSpec, pageSpecError]);

  const scheduleSave = (
    next: Partial<{
      allPages: boolean;
      pageSpec: string;
      cor: AnaliseLabMarkCor;
      rotulo: string;
      espelhar: boolean;
      geom: Record<string, number | string>;
    }> = {},
  ) => {
    const payload = buildPayload({
      mark,
      allPages: next.allPages ?? allPages,
      allPagesSpec,
      pageSpec: next.pageSpec ?? pageSpec,
      cor: next.cor ?? cor,
      rotulo: next.rotulo ?? rotulo,
      espelhar: next.espelhar ?? espelhar,
      geom: next.geom ?? geom,
    });
    if (!payload) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onSave(payload), 300);
  };

  useEffect(() => {
    if (skipFirst.current) {
      skipFirst.current = false;
      return;
    }
    scheduleSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounce on field deps
  }, [allPages, pageSpec, cor, rotulo, espelhar, geom]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const setNum = (key: string, value: number) => {
    setGeom((g) => ({ ...g, [key]: value }));
  };

  const showStroke =
    mark.tipo === "seta" || mark.tipo === "circulo" || mark.tipo === "livre";

  return (
    <div className="space-y-1.5 rounded border border-primary-green/30 bg-white p-1.5">
      <div className="flex items-center justify-between gap-1">
        <span className="text-[11px] font-semibold text-neutral-700">
          Editar · {labelTipo(mark.tipo)}
        </span>
        <button
          type="button"
          disabled={busy}
          title="Excluir marca"
          aria-label="Excluir marca"
          className="inline-flex size-7 items-center justify-center rounded text-sagra-danger hover:bg-red-50 disabled:opacity-50"
          onClick={onDelete}
        >
          <Trash2 className="size-3.5" aria-hidden />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {(mark.tipo === "offset_corte" || mark.tipo === "faixa") && (
          <>
            <label className="flex items-center gap-1 text-[11px] text-neutral-600">
              Borda
              <select
                value={String(geom.edge || "top")}
                disabled={busy}
                onChange={(e) =>
                  setGeom((g) => ({
                    ...g,
                    edge: e.target.value as AnaliseLabEdge,
                  }))
                }
                className={inputClass}
              >
                {EDGE_OPTIONS.map((e) => (
                  <option key={e} value={e}>
                    {labelEdge(e)}
                  </option>
                ))}
              </select>
            </label>
            {mark.tipo === "offset_corte" ? (
              <label className="flex items-center gap-1 text-[11px] text-neutral-600">
                Offset
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  disabled={busy}
                  value={Number(geom.offsetMm) || 0}
                  onChange={(e) =>
                    setNum("offsetMm", Number(e.target.value) || 0)
                  }
                  className={`${inputClass} w-14`}
                />
              </label>
            ) : (
              <>
                <label className="flex items-center gap-1 text-[11px] text-neutral-600">
                  De
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    disabled={busy}
                    value={Number(geom.fromMm) || 0}
                    onChange={(e) =>
                      setNum("fromMm", Number(e.target.value) || 0)
                    }
                    className={`${inputClass} w-14`}
                  />
                </label>
                <label className="flex items-center gap-1 text-[11px] text-neutral-600">
                  Até
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    disabled={busy}
                    value={Number(geom.toMm) || 0}
                    onChange={(e) =>
                      setNum("toMm", Number(e.target.value) || 0)
                    }
                    className={`${inputClass} w-14`}
                  />
                </label>
              </>
            )}
          </>
        )}

        {mark.tipo === "sangria" && (
          <>
            <label className="flex items-center gap-1 text-[11px] text-neutral-600">
              Borda
              <select
                value={String(geom.edge || "left")}
                disabled={busy}
                onChange={(e) =>
                  setGeom((g) => ({
                    ...g,
                    edge: e.target.value as AnaliseLabEdge,
                  }))
                }
                className={inputClass}
              >
                {EDGE_OPTIONS_SANGRIA.map((e) => (
                  <option key={e} value={e}>
                    {labelEdge(e)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1 text-[11px] text-neutral-600">
              Prof.
              <input
                type="number"
                min={0.5}
                max={50}
                step={0.5}
                disabled={busy}
                value={Math.abs(Number(geom.fromMm) || 0)}
                onChange={(e) => {
                  const depth = Math.max(0.5, Number(e.target.value) || 5);
                  setGeom((g) => ({ ...g, fromMm: -depth, toMm: 0 }));
                }}
                className={`${inputClass} w-14`}
              />
            </label>
          </>
        )}

        {showStroke ? (
          <label className="flex items-center gap-1 text-[11px] text-neutral-600">
            Espessura
            <select
              value={Number(geom.espessura) || 2}
              disabled={busy}
              onChange={(e) =>
                setNum("espessura", Number(e.target.value) || 2)
              }
              className={inputClass}
            >
              <option value={1}>Fina</option>
              <option value={2}>Média</option>
              <option value={3}>Grossa</option>
            </select>
          </label>
        ) : null}

        {mark.tipo === "texto" ? (
          <>
            <label className="flex items-center gap-1 text-[11px] text-neutral-600">
              Texto
              <input
                value={String(geom.texto || "")}
                disabled={busy}
                maxLength={200}
                onChange={(e) =>
                  setGeom((g) => ({ ...g, texto: e.target.value }))
                }
                className={`${inputClass} w-28`}
              />
            </label>
            <label className="flex items-center gap-1 text-[11px] text-neutral-600">
              pt
              <input
                type="number"
                min={6}
                max={72}
                disabled={busy}
                value={Number(geom.tamanhoPt) || 12}
                onChange={(e) =>
                  setNum("tamanhoPt", Number(e.target.value) || 12)
                }
                className={`${inputClass} w-12`}
              />
            </label>
          </>
        ) : null}

        {mark.tipo === "grade" ? (
          <label className="flex items-center gap-1 text-[11px] text-neutral-600">
            Passo
            <input
              type="number"
              min={1}
              max={50}
              disabled={busy}
              value={Number(geom.stepMm) || 10}
              onChange={(e) => setNum("stepMm", Number(e.target.value) || 10)}
              className={`${inputClass} w-12`}
            />
          </label>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <label className="flex items-center gap-1 text-[11px] text-neutral-700">
          <input
            type="checkbox"
            checked={allPages}
            disabled={busy || !allPagesSpec}
            onChange={(e) => {
              const next = e.target.checked;
              if (next) {
                setSavedSpec(pageSpec);
                setPageSpec(allPagesSpec);
              } else {
                setPageSpec(
                  savedSpec ||
                    String(mark.paginaOrigem || mark.pagina || 1),
                );
              }
              setAllPages(next);
            }}
          />
          Todas as páginas
        </label>

        {!allPages ? (
          <label className="flex items-center gap-1 text-[11px] text-neutral-600">
            Págs.
            <input
              value={pageSpec}
              disabled={busy}
              onChange={(e) => setPageSpec(e.target.value)}
              placeholder="1-15,20"
              className={`${inputClass} w-24 ${pageSpecError ? "border-sagra-danger" : ""}`}
              title={pageSpecError ?? undefined}
            />
          </label>
        ) : null}

        <input
          type="color"
          value={markCorToHex(cor)}
          disabled={busy}
          title="Cor"
          aria-label="Cor da marca"
          className={colorSwatchClass}
          onChange={(e) => setCor(nearestMarkCor(e.target.value))}
        />

        <label className="flex items-center gap-1 text-[11px] text-neutral-600">
          Rótulo
          <input
            value={rotulo}
            disabled={busy}
            maxLength={120}
            onChange={(e) => setRotulo(e.target.value)}
            placeholder="Opcional"
            className={`${inputClass} w-24`}
          />
        </label>

        {showMirror ? (
          <label className="flex items-center gap-1 text-[11px] text-neutral-700">
            <input
              type="checkbox"
              checked={espelhar}
              disabled={busy}
              onChange={(e) => setEspelhar(e.target.checked)}
            />
            Espelhar
          </label>
        ) : null}
      </div>
    </div>
  );
}
