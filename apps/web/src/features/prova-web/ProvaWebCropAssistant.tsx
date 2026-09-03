import { ArrowLeft, Loader2 } from "lucide-react";
import { useCallback, useState } from "react";

import {
  emptyCropSides,
  type ProvaWebBookExtras,
  type CropSidesMm,
  type ProvaWebCapaCrop,
  type ProvaWebCropJson,
  type ProvaWebModo,
} from "@/api/provaWeb";
import { ProvaWebBoxWizard } from "./ProvaWebBoxWizard";
import { ProvaWebBookExtrasPanel } from "./ProvaWebBookExtrasPanel";
import { defaultCapaCrop, ProvaWebCoverWizard } from "./ProvaWebCoverWizard";
import { ProvaWebCropPanel } from "./ProvaWebCropPanel";
import { ProvaWebFoldWizard } from "./ProvaWebFoldWizard";
import { ProvaWebSpiralWizard } from "./ProvaWebSpiralWizard";
import { emptyBookExtras, normalizeBookExtras } from "./provaWebBookExtras";

export interface ProvaWebCropAssistantProps {
  ano: number;
  osId: number;
  modo: ProvaWebModo;
  arquivoUnico: string | null;
  arquivoCapa: string | null;
  arquivoMiolo: string | null;
  saving?: boolean;
  onBack: () => void;
  onConfirm: (cropJson: ProvaWebCropJson) => void;
  formato?: string | null;
  formatoAlturaMm?: number | null;
  formatoLarguraMm?: number | null;
  /** Crop/config já salvos (editar rascunho). */
  initialCropJson?: ProvaWebCropJson | null;
}

export function ProvaWebCropAssistant({
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
}: ProvaWebCropAssistantProps) {
  if (modo === "folha_dobrada" && arquivoUnico) {
    return (
      <ProvaWebFoldWizard
        ano={ano}
        osId={osId}
        arquivoUnico={arquivoUnico}
        saving={saving}
        onBack={onBack}
        onConfirm={onConfirm}
        formato={formato}
        formatoAlturaMm={formatoAlturaMm}
        formatoLarguraMm={formatoLarguraMm}
        initialFolheto={initialCropJson?.folheto ?? initialCropJson}
      />
    );
  }

  if (modo === "espiral") {
    const sourceKind =
      initialCropJson?.espiral?.sourceKind === "capa_miolo"
        ? "capa_miolo"
        : "unico";
    return (
      <ProvaWebSpiralWizard
        ano={ano}
        osId={osId}
        sourceKind={sourceKind}
        arquivoUnico={arquivoUnico}
        arquivoCapa={arquivoCapa}
        arquivoMiolo={arquivoMiolo}
        saving={saving}
        onBack={onBack}
        onConfirm={onConfirm}
        formato={formato}
        formatoAlturaMm={formatoAlturaMm}
        formatoLarguraMm={formatoLarguraMm}
        initialCropJson={initialCropJson}
      />
    );
  }

  if (modo === "caixa") {
    const sk = initialCropJson?.caixa?.sourceKind;
    const sourceKind =
      sk === "separate" || sk === "combined" || sk === "model"
        ? sk
        : "model";
    return (
      <ProvaWebBoxWizard
        ano={ano}
        osId={osId}
        sourceKind={sourceKind}
        arquivoUnico={arquivoUnico}
        arquivoCapa={arquivoCapa}
        arquivoMiolo={arquivoMiolo}
        saving={saving}
        onBack={onBack}
        onConfirm={onConfirm}
        initialCropJson={initialCropJson}
      />
    );
  }

  return (
    <ProvaWebBookCropAssistant
      ano={ano}
      osId={osId}
      modo={modo === "capa_miolo" ? "capa_miolo" : "unico"}
      arquivoUnico={arquivoUnico}
      arquivoCapa={arquivoCapa}
      arquivoMiolo={arquivoMiolo}
      saving={saving}
      onBack={onBack}
      onConfirm={onConfirm}
      formato={formato}
      formatoAlturaMm={formatoAlturaMm}
      formatoLarguraMm={formatoLarguraMm}
      initialCropJson={initialCropJson}
    />
  );
}

function ProvaWebBookCropAssistant({
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
}: Omit<ProvaWebCropAssistantProps, "modo"> & {
  modo: "unico" | "capa_miolo";
}) {
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
  const [bookExtras, setBookExtras] = useState<ProvaWebBookExtras>(() =>
    initialCropJson?.bookExtras
      ? normalizeBookExtras(initialCropJson.bookExtras)
      : emptyBookExtras(),
  );
  const [pageIndex, setPageIndex] = useState(0);

  const stableUnico = useCallback((c: CropSidesMm) => setUnicoCrop(c), []);
  const stableMiolo = useCallback((c: CropSidesMm) => setMioloCrop(c), []);

  const handleGenerate = () => {
    const extras =
      bookExtras.inserts.length > 0 ? { bookExtras: normalizeBookExtras(bookExtras) } : {};
    if (modo === "unico") {
      onConfirm({ unico: unicoCrop, ...extras });
      return;
    }
    onConfirm({ miolo: mioloCrop, capa, ...extras });
  };

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-4 p-4">
      <div className="shrink-0">
        <h2 className="text-sm font-semibold text-neutral-800">
          Assistente de crop
        </h2>
        <p className="mt-0.5 text-xs text-neutral-500">
          Ajuste crop e marcações com preview ao vivo. O formato da OS orienta o
          pré-preenchimento quando não há TrimBox.
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto pb-2">
        {modo === "unico" && arquivoUnico && (
          <>
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
              />
            </section>
            <ProvaWebBookExtrasPanel
              ano={ano}
              osId={osId}
              mode="unico"
              arquivoUnico={arquivoUnico}
              arquivoCapa={arquivoCapa}
              arquivoMiolo={arquivoMiolo}
              value={bookExtras}
              onChange={setBookExtras}
            />
          </>
        )}

        {modo === "capa_miolo" && (
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
                />
              ) : (
                <p className="text-sm text-neutral-500">Selecione o miolo.</p>
              )}
            </section>

            <section className="rounded-2xl border border-sagra-border bg-white p-4 shadow-sm">
              <h3 className="mb-3 text-sm font-semibold text-neutral-800">
                2 · Capa
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
                />
              ) : (
                <p className="text-sm text-neutral-500">Selecione a capa.</p>
              )}
            </section>

            <ProvaWebBookExtrasPanel
              ano={ano}
              osId={osId}
              mode="capa_miolo"
              arquivoUnico={arquivoUnico}
              arquivoCapa={arquivoCapa}
              arquivoMiolo={arquivoMiolo}
              value={bookExtras}
              onChange={setBookExtras}
            />
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-sagra-border bg-slate-50/95 py-3">
        <button
          type="button"
          onClick={onBack}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-lg border border-sagra-border bg-white px-4 py-2 text-sm text-neutral-700 shadow-sm hover:bg-neutral-100 disabled:opacity-40"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Voltar
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={handleGenerate}
          className="inline-flex items-center gap-2 rounded-lg bg-primary-green px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
          Gerar Prova WEB
        </button>
      </div>
    </div>
  );
}
