import { ArrowLeft, Loader2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

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

import {
  defaultFolhearModo,
  normalizeFolhearModo,
  type AnaliseLabFolhearModo,
} from "./analiseLabFolhearModo";

export interface AnaliseLabCropAssistantProps {
  ano: number;
  osId: number;
  modo: "unico" | "capa_miolo";
  arquivoUnico: string | null;
  arquivoCapa: string | null;
  arquivoMiolo: string | null;
  saving?: boolean;
  onBack: () => void;
  onConfirm: (
    cropJson: ProvaWebCropJson,
    folhearModo: AnaliseLabFolhearModo,
  ) => void;
  formato?: string | null;
  formatoAlturaMm?: number | null;
  formatoLarguraMm?: number | null;
  initialCropJson?: ProvaWebCropJson | null;
  initialFolhearModo?: AnaliseLabFolhearModo | null;
}

export function AnaliseLabCropAssistant({
  ano,
  osId,
  modo,
  arquivoUnico,
  arquivoCapa,
  arquivoMiolo,
  saving = false,
  onBack,
  onConfirm,
  formato = null,
  formatoAlturaMm = null,
  formatoLarguraMm = null,
  initialCropJson = null,
  initialFolhearModo = null,
}: AnaliseLabCropAssistantProps) {
  const cropSource = useMemo<ProvaWebCropSource>(
    () => ({
      keyPrefix: "analise-lab-crop-meta",
      pdfUrl: (relativePath) => analiseLabSourcePdfUrl(ano, osId, relativePath),
      fetchMeta: (relativePath, opts) =>
        fetchAnaliseLabCropMeta(ano, osId, relativePath, opts),
    }),
    [ano, osId],
  );

  const [unicoCrop, setUnicoCrop] = useState<CropSidesMm>(() =>
    initialCropJson?.unico
      ? { ...emptyCropSides(), ...initialCropJson.unico }
      : emptyCropSides(),
  );
  const [mioloCrop, setMioloCrop] = useState<CropSidesMm>(() =>
    initialCropJson?.miolo
      ? { ...emptyCropSides(), ...initialCropJson.miolo }
      : emptyCropSides(),
  );
  const [capa, setCapa] = useState<ProvaWebCapaCrop>(() =>
    initialCropJson?.capa
      ? { ...defaultCapaCrop("spread"), ...initialCropJson.capa }
      : defaultCapaCrop("spread"),
  );
  const [pageIndex, setPageIndex] = useState(0);
  const [folhearModo, setFolhearModo] = useState<AnaliseLabFolhearModo>(() =>
    initialFolhearModo
      ? normalizeFolhearModo(initialFolhearModo, modo)
      : defaultFolhearModo(modo),
  );

  const stableUnico = useCallback((c: CropSidesMm) => setUnicoCrop(c), []);
  const stableMiolo = useCallback((c: CropSidesMm) => setMioloCrop(c), []);

  const handleGenerate = () => {
    if (modo === "unico") {
      onConfirm({ unico: unicoCrop }, folhearModo);
      return;
    }
    onConfirm({ miolo: mioloCrop, capa }, folhearModo);
  };

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-4 overflow-hidden p-4">
      <div className="flex shrink-0 items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-neutral-800">
            Configuração de corte
          </h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            Ajuste crop, lombada e orelhas para analisar o arquivo já montado —
            igual à Prova WEB.
          </p>
        </div>
        <button
          type="button"
          onClick={onBack}
          disabled={saving}
          className="inline-flex items-center gap-1 rounded border border-sagra-border px-2 py-1.5 text-xs"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          Voltar
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto pb-2">
        {modo === "unico" && arquivoUnico ? (
          <section className="rounded-2xl border border-sagra-border bg-white p-4 shadow-sm">
            <ProvaWebCropPanel
              ano={ano}
              osId={osId}
              relativePath={arquivoUnico}
              title="Crop do arquivo único (mm)"
              crop={unicoCrop}
              onChange={stableUnico}
              pageIndex={pageIndex}
              onPageIndexChange={setPageIndex}
              formatoLabel={formato}
              formatoLarguraMm={formatoLarguraMm}
              formatoAlturaMm={formatoAlturaMm}
              cropSource={cropSource}
            />
          </section>
        ) : null}

        {modo === "capa_miolo" ? (
          <>
            <section className="rounded-2xl border border-sagra-border bg-white p-4 shadow-sm">
              <h3 className="mb-3 text-sm font-semibold text-neutral-800">
                1 · Miolo
              </h3>
              {arquivoMiolo ? (
                <ProvaWebCropPanel
                  ano={ano}
                  osId={osId}
                  relativePath={arquivoMiolo}
                  title="Crop do miolo (mm)"
                  crop={mioloCrop}
                  onChange={stableMiolo}
                  pageIndex={pageIndex}
                  onPageIndexChange={setPageIndex}
                  formatoLabel={formato}
                  formatoLarguraMm={formatoLarguraMm}
                  formatoAlturaMm={formatoAlturaMm}
                  cropSource={cropSource}
                />
              ) : (
                <p className="text-sm text-neutral-500">Selecione o miolo.</p>
              )}
            </section>

            <section className="rounded-2xl border border-sagra-border bg-white p-4 shadow-sm">
              <h3 className="mb-3 text-sm font-semibold text-neutral-800">
                2 · Capa (lombada e orelhas)
              </h3>
              {arquivoCapa ? (
                <ProvaWebCoverWizard
                  ano={ano}
                  osId={osId}
                  capaPath={arquivoCapa}
                  mioloPath={arquivoMiolo}
                  mioloCrop={mioloCrop}
                  value={capa}
                  onChange={setCapa}
                  formatoLabel={formato}
                  formatoLarguraMm={formatoLarguraMm}
                  formatoAlturaMm={formatoAlturaMm}
                  cropSource={cropSource}
                />
              ) : (
                <p className="text-sm text-neutral-500">Selecione a capa.</p>
              )}
            </section>
          </>
        ) : null}

        <section className="rounded-2xl border border-sagra-border bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-neutral-800">
            Como exibir no Folhear?
          </h3>
          <p className="mt-0.5 text-xs text-neutral-500">
            Flipbook vira as páginas como livro; folhas separadas lista cada
            página na vertical, como na aba Inspeção.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <label
              className={
                folhearModo === "flipbook"
                  ? "inline-flex cursor-pointer items-center gap-2 rounded-lg border border-primary-green bg-primary-green/10 px-3 py-2 text-sm text-primary-green"
                  : "inline-flex cursor-pointer items-center gap-2 rounded-lg border border-sagra-border bg-white px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
              }
            >
              <input
                type="radio"
                name="folhear-modo"
                className="sr-only"
                checked={folhearModo === "flipbook"}
                onChange={() => setFolhearModo("flipbook")}
              />
              Flipbook
            </label>
            <label
              className={
                folhearModo === "folhas"
                  ? "inline-flex cursor-pointer items-center gap-2 rounded-lg border border-primary-green bg-primary-green/10 px-3 py-2 text-sm text-primary-green"
                  : "inline-flex cursor-pointer items-center gap-2 rounded-lg border border-sagra-border bg-white px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
              }
            >
              <input
                type="radio"
                name="folhear-modo"
                className="sr-only"
                checked={folhearModo === "folhas"}
                onChange={() => setFolhearModo("folhas")}
              />
              Folhas separadas
            </label>
          </div>
        </section>
      </div>

      <div className="flex shrink-0 justify-end gap-2 border-t border-sagra-border pt-3">
        <button
          type="button"
          disabled={saving}
          onClick={handleGenerate}
          className="inline-flex items-center gap-2 rounded-lg bg-secondary-blue px-4 py-2.5 text-sm font-semibold text-white hover:bg-secondary-blue/90 disabled:opacity-50"
        >
          {saving ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : null}
          Gerar visualização do laboratório
        </button>
      </div>
    </div>
  );
}
