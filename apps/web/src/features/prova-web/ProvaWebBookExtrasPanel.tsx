import { Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type {
  ProvaWebBookExtraInsert,
  ProvaWebBookExtraKind,
  ProvaWebBookExtraSource,
  ProvaWebBookExtras,
} from "@/api/provaWeb";

import {
  BookExtraFoldEditor,
  draftFromFoldConfig,
  emptyBookExtraFoldDraft,
  packBookExtraFoldDraft,
  type BookExtraFoldDraft,
} from "./BookExtraFoldEditor";
import {
  BOOK_EXTRA_FOLD_KINDS,
  BOOK_EXTRA_KIND_LABELS,
  BOOK_EXTRA_SOURCE_LABELS,
  foldLinesFromCreases,
  nextBookExtraId,
  normalizeBookExtras,
} from "./provaWebBookExtras";
import { useProvaWebCropMeta } from "./useProvaWebCropMeta";

interface ProvaWebBookExtrasPanelProps {
  ano: number;
  osId: number;
  mode: "unico" | "capa_miolo";
  arquivoUnico: string | null;
  arquivoCapa: string | null;
  arquivoMiolo: string | null;
  value: ProvaWebBookExtras;
  onChange: (value: ProvaWebBookExtras) => void;
}

const KIND_OPTIONS: ProvaWebBookExtraKind[] = [
  "insert",
  "large-sheet",
  "foldout",
  "gatefold",
  "zfold",
  "custom-fold",
];

function sourcePath(
  source: ProvaWebBookExtraSource,
  paths: Pick<
    ProvaWebBookExtrasPanelProps,
    "arquivoUnico" | "arquivoCapa" | "arquivoMiolo"
  >,
): string | null {
  if (source === "unico") return paths.arquivoUnico;
  if (source === "capa") return paths.arquivoCapa;
  return paths.arquivoMiolo;
}

export function ProvaWebBookExtrasPanel({
  ano,
  osId,
  mode,
  arquivoUnico,
  arquivoCapa,
  arquivoMiolo,
  value,
  onChange,
}: ProvaWebBookExtrasPanelProps) {
  const sources: ProvaWebBookExtraSource[] =
    mode === "unico" ? ["unico"] : ["miolo", "capa"];
  const defaultSource = sources[0] ?? "miolo";
  const [source, setSource] = useState<ProvaWebBookExtraSource>(defaultSource);
  const [start, setStart] = useState("1");
  const [end, setEnd] = useState("1");
  const [kind, setKind] = useState<ProvaWebBookExtraKind>("large-sheet");
  const [hasVerso, setHasVerso] = useState(false);
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [label, setLabel] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [foldDraft, setFoldDraft] = useState<BookExtraFoldDraft>(() =>
    emptyBookExtraFoldDraft(420, 297),
  );

  const selectedPath = sourcePath(source, {
    arquivoUnico,
    arquivoCapa,
    arquivoMiolo,
  });
  const metaQuery = useProvaWebCropMeta(ano, osId, selectedPath);
  const pageStart = Math.max(1, Number.parseInt(start, 10) || 1);
  const pageMeta = metaQuery.data?.pages.find(
    (page) => page.pageIndex === pageStart - 1,
  );
  const suggestedWidth = pageMeta?.widthMm ?? metaQuery.data?.widthMm ?? 210;
  const suggestedHeight = pageMeta?.heightMm ?? metaQuery.data?.heightMm ?? 297;
  const openWidth = Number(width) || suggestedWidth;
  const openHeight = Number(height) || suggestedHeight;
  const normalized = useMemo(() => normalizeBookExtras(value), [value]);
  const isFoldKind = BOOK_EXTRA_FOLD_KINDS.has(kind);
  const duplex = isFoldKind && hasVerso;

  useEffect(() => {
    if (!isFoldKind && hasVerso) setHasVerso(false);
  }, [isFoldKind, hasVerso]);

  useEffect(() => {
    if (duplex) {
      const from = Math.max(1, Number.parseInt(start, 10) || 1);
      const to = Math.max(1, Number.parseInt(end, 10) || from);
      if (to === from) setEnd(String(from + 1));
    }
  }, [duplex, start, end]);

  const setInserts = (inserts: ProvaWebBookExtraInsert[]) => {
    onChange({ version: 1, inserts });
  };

  const resetForm = () => {
    setEditingId(null);
    setLabel("");
    setKind("large-sheet");
    setHasVerso(false);
    setFoldDraft(emptyBookExtraFoldDraft(suggestedWidth * 2, suggestedHeight));
  };

  const loadInsertForEdit = (insert: ProvaWebBookExtraInsert) => {
    setEditingId(insert.id);
    setSource(insert.sourceComponent);
    setStart(String(insert.sourcePageStart));
    setEnd(String(insert.sourcePageEnd));
    setKind(insert.kind);
    setHasVerso(Boolean(insert.hasVerso));
    setWidth(String(insert.widthMm));
    setHeight(String(insert.heightMm));
    setLabel(insert.label);
    if (insert.kind === "custom-fold") {
      setFoldDraft(
        draftFromFoldConfig(insert.foldConfig, insert.widthMm, insert.heightMm),
      );
    } else {
      setFoldDraft(
        emptyBookExtraFoldDraft(insert.widthMm, insert.heightMm),
      );
    }
  };

  const buildInsert = (): ProvaWebBookExtraInsert | null => {
    const from = Math.max(1, Number.parseInt(start, 10) || 1);
    let to = Math.max(from, Number.parseInt(end, 10) || from);
    const useVerso = BOOK_EXTRA_FOLD_KINDS.has(kind) && hasVerso;
    if (useVerso && to === from) to = from + 1;
    const w = Math.round(openWidth * 10) / 10;
    const h = Math.round(openHeight * 10) / 10;
    const id = editingId ?? nextBookExtraId(normalized.inserts);

    let foldConfig = null;
    let foldLines: ProvaWebBookExtraInsert["foldLines"] = [];
    if (kind === "custom-fold") {
      foldConfig = packBookExtraFoldDraft(foldDraft, w, h);
      if (!foldConfig) return null;
      foldLines = foldLinesFromCreases(foldDraft.creases);
    } else if (
      kind === "foldout" ||
      kind === "gatefold" ||
      kind === "zfold"
    ) {
      foldLines = [
        { axis: "vertical", positionMm: Math.round((w / 2) * 10) / 10 },
      ];
    }

    return {
      id,
      label: label.trim() || BOOK_EXTRA_KIND_LABELS[kind],
      sourceComponent: source,
      sourcePageStart: from,
      sourcePageEnd: to,
      kind,
      widthMm: w,
      heightMm: h,
      closedWidthMm: kind === "insert" || kind === "large-sheet" ? null : 210,
      closedHeightMm: kind === "insert" || kind === "large-sheet" ? null : 297,
      foldLines,
      hasVerso: useVerso,
      foldConfig,
      notes: null,
    };
  };

  const addOrUpdateInsert = () => {
    const insert = buildInsert();
    if (!insert) return;
    if (editingId) {
      setInserts(
        normalized.inserts.map((item) =>
          item.id === editingId ? insert : item,
        ),
      );
    } else {
      setInserts([...normalized.inserts, insert]);
    }
    resetForm();
  };

  return (
    <section className="rounded-2xl border border-sagra-border bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-neutral-800">
        Páginas especiais do livro
      </h3>
      <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_1fr_1fr_auto]">
        <label className="flex flex-col gap-1 text-xs text-neutral-600">
          Componente
          <select
            value={source}
            onChange={(event) =>
              setSource(event.target.value as ProvaWebBookExtraSource)
            }
            className="rounded-md border border-sagra-border bg-white px-2 py-1.5 text-sm text-neutral-800"
          >
            {sources.map((item) => (
              <option key={item} value={item}>
                {BOOK_EXTRA_SOURCE_LABELS[item]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-600">
          {duplex ? "Pág. frente" : "Página inicial"}
          <input
            type="number"
            min={1}
            value={start}
            onChange={(event) => setStart(event.target.value)}
            className="rounded-md border border-sagra-border px-2 py-1.5 text-sm text-neutral-800"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-600">
          {duplex ? "Pág. verso" : "Página final"}
          <input
            type="number"
            min={1}
            value={end}
            onChange={(event) => setEnd(event.target.value)}
            className="rounded-md border border-sagra-border px-2 py-1.5 text-sm text-neutral-800"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-600">
          Tratamento
          <select
            value={kind}
            onChange={(event) => {
              const next = event.target.value as ProvaWebBookExtraKind;
              setKind(next);
              if (next === "custom-fold") {
                setFoldDraft(emptyBookExtraFoldDraft(openWidth, openHeight));
              }
            }}
            className="rounded-md border border-sagra-border bg-white px-2 py-1.5 text-sm text-neutral-800"
          >
            {KIND_OPTIONS.map((item) => (
              <option key={item} value={item}>
                {BOOK_EXTRA_KIND_LABELS[item]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={addOrUpdateInsert}
          disabled={kind === "custom-fold" && !packBookExtraFoldDraft(foldDraft, openWidth, openHeight)}
          className="mt-5 inline-flex items-center justify-center gap-1.5 rounded-lg bg-secondary-blue px-3 py-2 text-sm font-semibold text-white hover:bg-secondary-blue/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="size-4" aria-hidden />
          {editingId ? "Salvar" : "Adicionar"}
        </button>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-4">
        <label className="flex flex-col gap-1 text-xs text-neutral-600">
          Nome
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder={BOOK_EXTRA_KIND_LABELS[kind]}
            className="rounded-md border border-sagra-border px-2 py-1.5 text-sm text-neutral-800"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-600">
          Largura aberta (mm)
          <input
            type="number"
            min={10}
            step="0.1"
            value={width}
            onChange={(event) => setWidth(event.target.value)}
            placeholder={suggestedWidth.toFixed(1)}
            className="rounded-md border border-sagra-border px-2 py-1.5 text-sm text-neutral-800"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-600">
          Altura aberta (mm)
          <input
            type="number"
            min={10}
            step="0.1"
            value={height}
            onChange={(event) => setHeight(event.target.value)}
            placeholder={suggestedHeight.toFixed(1)}
            className="rounded-md border border-sagra-border px-2 py-1.5 text-sm text-neutral-800"
          />
        </label>
        {isFoldKind ? (
          <label className="flex flex-col gap-1 text-xs text-neutral-600">
            Faces
            <select
              value={hasVerso ? "front-back" : "front"}
              onChange={(event) =>
                setHasVerso(event.target.value === "front-back")
              }
              className="rounded-md border border-sagra-border bg-white px-2 py-1.5 text-sm text-neutral-800"
            >
              <option value="front">Apenas frente</option>
              <option value="front-back">Frente e verso</option>
            </select>
          </label>
        ) : (
          <div />
        )}
      </div>

      {kind === "custom-fold" ? (
        <BookExtraFoldEditor
          widthMm={openWidth}
          heightMm={openHeight}
          value={foldDraft}
          onChange={setFoldDraft}
          ano={ano}
          osId={osId}
          pdfPath={selectedPath}
        />
      ) : null}

      {editingId ? (
        <div className="mt-2 flex items-center gap-2 text-xs text-neutral-500">
          <span>Editando {editingId}</span>
          <button
            type="button"
            onClick={resetForm}
            className="underline hover:text-neutral-800"
          >
            Cancelar
          </button>
        </div>
      ) : null}

      {metaQuery.isLoading ? (
        <p className="mt-2 text-xs text-neutral-500">
          Lendo dimensões do PDF selecionado…
        </p>
      ) : null}

      {normalized.inserts.length ? (
        <ul className="mt-4 divide-y divide-sagra-border overflow-hidden rounded-lg border border-sagra-border">
          {normalized.inserts.map((insert) => (
            <li
              key={insert.id}
              className="flex flex-wrap items-center justify-between gap-3 bg-white px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-neutral-800">
                  {insert.label}
                </p>
                <p className="text-xs text-neutral-500">
                  {BOOK_EXTRA_SOURCE_LABELS[insert.sourceComponent]} ·{" "}
                  {insert.hasVerso
                    ? `frente ${insert.sourcePageStart} / verso ${insert.sourcePageEnd}`
                    : `páginas ${insert.sourcePageStart}${
                        insert.sourcePageEnd !== insert.sourcePageStart
                          ? `-${insert.sourcePageEnd}`
                          : ""
                      }`}{" "}
                  · {BOOK_EXTRA_KIND_LABELS[insert.kind]} ·{" "}
                  {insert.widthMm.toFixed(1)}×{insert.heightMm.toFixed(1)} mm
                  {insert.hasVerso ? " · frente+verso" : ""}
                  {insert.kind === "custom-fold" && insert.foldConfig
                    ? ` · ${insert.foldConfig.creases.length} vincos`
                    : ""}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => loadInsertForEdit(insert)}
                  className="rounded-lg border border-sagra-border p-2 text-neutral-500 hover:bg-neutral-100"
                  aria-label={`Editar ${insert.label}`}
                  title="Editar"
                >
                  <Pencil className="size-4" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setInserts(
                      normalized.inserts.filter((item) => item.id !== insert.id),
                    )
                  }
                  className="rounded-lg border border-sagra-border p-2 text-neutral-500 hover:bg-neutral-100 hover:text-sagra-danger"
                  aria-label={`Remover ${insert.label}`}
                  title="Remover"
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 rounded-lg border border-dashed border-sagra-border px-3 py-3 text-xs text-neutral-500">
          Nenhuma página especial configurada.
        </p>
      )}
    </section>
  );
}
