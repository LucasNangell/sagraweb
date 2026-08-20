import { useEffect, useMemo, useState } from "react";

import type {
  AnaliseLabComponente,
  AnaliseLabCropScope,
} from "@/api/analiseLab";
import {
  analiseLabSourcePdfUrl,
  fetchAnaliseLabCropMeta,
} from "@/api/analiseLab";
import {
  emptyCropSides,
  type CropSidesMm,
  type ProvaWebCapaCrop,
  type ProvaWebCropJson,
} from "@/api/provaWeb";
import { defaultCapaCrop, ProvaWebCoverWizard } from "@/features/prova-web/ProvaWebCoverWizard";
import { ProvaWebCropPanel } from "@/features/prova-web/ProvaWebCropPanel";
import type { ProvaWebCropSource } from "@/features/prova-web/provaWebCropSource";

import { CROP_SCOPE_LABELS, resolveLabPageCrop } from "./analiseLabFontes";

interface AnaliseLabCropToolPanelProps {
  ano: number;
  osId: number;
  sourcePath: string;
  sourcePage: number;
  sequencePage?: number | null;
  componente: AnaliseLabComponente | string;
  isSpreadHalf?: boolean;
  cropJson: ProvaWebCropJson | null;
  modo: "unico" | "capa_miolo" | string;
  capaPath: string | null;
  mioloPath: string | null;
  formato?: string | null;
  formatoAlturaMm?: number | null;
  formatoLarguraMm?: number | null;
  saving?: boolean;
  onApply: (payload: {
    crop: CropSidesMm;
    scope: AnaliseLabCropScope;
    path: string;
    sourcePage: number;
    sequencePage?: number | null;
    componente: string;
    capa?: ProvaWebCapaCrop | null;
  }) => void;
}

export function AnaliseLabCropToolPanel({
  ano,
  osId,
  sourcePath,
  sourcePage,
  sequencePage = null,
  componente,
  isSpreadHalf = false,
  cropJson,
  modo,
  capaPath,
  mioloPath,
  formato = null,
  formatoAlturaMm = null,
  formatoLarguraMm = null,
  saving = false,
  onApply,
}: AnaliseLabCropToolPanelProps) {
  const cropSource = useMemo<ProvaWebCropSource>(
    () => ({
      keyPrefix: "analise-lab-crop-meta",
      pdfUrl: (relativePath) => analiseLabSourcePdfUrl(ano, osId, relativePath),
      fetchMeta: (relativePath, opts) =>
        fetchAnaliseLabCropMeta(ano, osId, relativePath, opts),
    }),
    [ano, osId],
  );

  const isCapaContext = String(componente) === "Capa";
  const isMioloContext = String(componente) === "Miolo";

  const [crop, setCrop] = useState<CropSidesMm>(() =>
    resolveLabPageCrop(cropJson, {
      path: sourcePath,
      sourcePage,
      componente,
      sequencePage,
    }),
  );
  const [scope, setScope] = useState<AnaliseLabCropScope>("page");
  const [capa, setCapa] = useState<ProvaWebCapaCrop>(() =>
    cropJson?.capa
      ? { ...defaultCapaCrop("pages"), ...cropJson.capa }
      : defaultCapaCrop("pages"),
  );
  const [pageIndex, setPageIndex] = useState(Math.max(0, sourcePage - 1));

  useEffect(() => {
    setCrop(
      resolveLabPageCrop(cropJson, {
        path: sourcePath,
        sourcePage,
        componente,
        sequencePage,
      }),
    );
    setPageIndex(Math.max(0, sourcePage - 1));
    setCapa(
      cropJson?.capa
        ? { ...defaultCapaCrop("pages"), ...cropJson.capa }
        : defaultCapaCrop("pages"),
    );
  }, [componente, cropJson, sequencePage, sourcePage, sourcePath]);

  useEffect(() => {
    if (scope === "miolo_central" && !isMioloContext) {
      setScope("page");
    }
  }, [isMioloContext, scope]);

  const scopes: AnaliseLabCropScope[] =
    modo === "capa_miolo" && isMioloContext
      ? ["page", "file", "component", "miolo_central", "all"]
      : ["page", "file", "component", "all"];
  const showCover = modo === "capa_miolo" && Boolean(capaPath);
  /** No contexto capa, o crop mm vem só do CoverWizard. */
  const showMainCropPanel = !showCover || !isCapaContext;

  return (
    <div className="max-h-[46vh] overflow-y-auto border-b border-sagra-border bg-white px-3 py-2">
      {isSpreadHalf ? (
        <p className="mb-2 text-[11px] text-amber-800">
          Esta página é metade de uma folha de capa; o crop da página atual vale
          para a folha inteira no PDF de origem.
        </p>
      ) : null}
      {showMainCropPanel ? (
        <ProvaWebCropPanel
          ano={ano}
          osId={osId}
          relativePath={sourcePath}
          title={`Crop — ${componente}`}
          crop={crop}
          onChange={setCrop}
          pageIndex={pageIndex}
          onPageIndexChange={setPageIndex}
          autoSeedCrop={false}
          formatoLabel={formato}
          formatoLarguraMm={formatoLarguraMm}
          formatoAlturaMm={formatoAlturaMm}
          cropSource={cropSource}
        />
      ) : null}

      {showMainCropPanel ? (
        <fieldset className="mt-3">
          <legend className="text-[11px] font-semibold uppercase tracking-wide text-neutral-600">
            Aplicar em
          </legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {scopes.map((id) => (
              <label
                key={id}
                className={
                  scope === id
                    ? "inline-flex cursor-pointer items-center gap-1.5 rounded border border-primary-green bg-primary-green/10 px-2 py-1 text-[11px] text-primary-green"
                    : "inline-flex cursor-pointer items-center gap-1.5 rounded border border-sagra-border px-2 py-1 text-[11px]"
                }
              >
                <input
                  type="radio"
                  name="lab-crop-scope"
                  className="sr-only"
                  checked={scope === id}
                  onChange={() => setScope(id)}
                />
                {CROP_SCOPE_LABELS[id]}
              </label>
            ))}
          </div>
          {scope === "miolo_central" ? (
            <p className="mt-1.5 text-[11px] text-neutral-600">
              Recorta a margem da lombada: esquerda nas páginas ímpares do miolo
              concatenado, direita nas pares. Topo e base valem para todas.
            </p>
          ) : null}
        </fieldset>
      ) : null}

      {showCover ? (
        <details
          className={
            showMainCropPanel
              ? "mt-3 rounded border border-sagra-border p-2"
              : "rounded border border-sagra-border p-2"
          }
          open={isCapaContext || undefined}
        >
          <summary className="cursor-pointer text-[11px] font-semibold text-neutral-700">
            Configuração da capa
          </summary>
          <div className="mt-2">
            <ProvaWebCoverWizard
              ano={ano}
              osId={osId}
              capaPath={capaPath || sourcePath}
              mioloPath={mioloPath}
              mioloCrop={
                isMioloContext ? crop : (cropJson?.miolo ?? emptyCropSides())
              }
              value={capa}
              onChange={setCapa}
              formatoLabel={formato}
              formatoLarguraMm={formatoLarguraMm}
              formatoAlturaMm={formatoAlturaMm}
              cropSource={cropSource}
              hideCropPanel={isMioloContext}
            />
          </div>
        </details>
      ) : null}

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          disabled={saving}
          onClick={() => {
            const applyCrop =
              isCapaContext && showCover
                ? (capa.crop ?? emptyCropSides())
                : crop;
            const applyScope: AnaliseLabCropScope =
              isCapaContext && showCover ? "component" : scope;
            onApply({
              crop: applyCrop,
              scope: applyScope,
              path: sourcePath,
              sourcePage,
              sequencePage,
              componente,
              capa: showCover ? capa : null,
            });
          }}
          className="rounded-lg bg-secondary-blue px-3 py-1.5 text-xs font-semibold text-white hover:bg-secondary-blue/90 disabled:opacity-50"
        >
          {saving ? "Aplicando…" : "Aplicar crop e regenerar"}
        </button>
      </div>
    </div>
  );
}
