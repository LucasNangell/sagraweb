import { useMutation, useQuery } from "@tanstack/react-query";
import { cn } from "@sagra/ui";
import { Download, Eye, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  exportPapelariaSvg,
  fetchPapelariaSvgFields,
  fetchPapelariaSvgModelos,
  fetchPapelariaSvgPrefill,
  renderPapelariaSvg,
} from "@/api/papelariaSvg";
import { queryKeys } from "@/api/query-keys";
import type { PapelariaField } from "../types";

type Props = {
  osId: string | null;
  osAno: string | null;
};

type SvgPreviewState =
  | { kind: "idle"; message?: string }
  | { kind: "loading" }
  | { kind: "svg"; url: string; warnings: string[] }
  | { kind: "error"; message: string };

export function PapelariaCartaoSvgPanel({ osId, osAno }: Props) {
  const [selectedCodigo, setSelectedCodigo] = useState("");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<SvgPreviewState>({ kind: "idle" });
  const [mobilePanel, setMobilePanel] = useState<"form" | "preview">("form");
  const prefillApplied = useRef(false);
  const previewUrlRef = useRef<string | null>(null);

  const anoNum = osAno ? parseInt(osAno, 10) : NaN;
  const nroNum = osId ? parseInt(osId, 10) : NaN;
  const hasOs = Number.isFinite(anoNum) && Number.isFinite(nroNum);

  const modelsQuery = useQuery({
    queryKey: queryKeys.papelaria.svgModelos,
    queryFn: fetchPapelariaSvgModelos,
  });

  const fieldsQuery = useQuery({
    queryKey: queryKeys.papelaria.svgFields(selectedCodigo),
    queryFn: () => fetchPapelariaSvgFields(selectedCodigo),
    enabled: Boolean(selectedCodigo),
  });

  const prefillQuery = useQuery({
    queryKey: queryKeys.papelaria.svgPrefill(anoNum, nroNum),
    queryFn: () => fetchPapelariaSvgPrefill(anoNum, nroNum),
    enabled: hasOs,
    staleTime: 60_000,
  });

  const revokePreviewUrl = useCallback(() => {
    if (previewUrlRef.current) {
      window.URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
  }, []);

  useEffect(() => () => revokePreviewUrl(), [revokePreviewUrl]);

  useEffect(() => {
    if (!fieldsQuery.data?.length) return;
    setFieldValues((prev) => {
      const next = { ...prev };
      for (const f of fieldsQuery.data) {
        if (f.default && !next[f.key]) {
          next[f.key] = f.default;
        }
      }
      return next;
    });
  }, [fieldsQuery.data]);

  useEffect(() => {
    if (prefillApplied.current || !prefillQuery.data) return;
    setFieldValues((prev) => ({ ...prefillQuery.data, ...prev }));
    prefillApplied.current = true;
  }, [prefillQuery.data]);

  const collectDados = useCallback((): Record<string, string> => {
    const dados: Record<string, string> = {};
    for (const [k, v] of Object.entries(fieldValues)) {
      if (k) dados[k] = v ?? "";
    }
    return dados;
  }, [fieldValues]);

  const handleModelChange = (codigo: string) => {
    revokePreviewUrl();
    setSelectedCodigo(codigo);
    setFieldValues({});
    prefillApplied.current = false;
    setPreview({
      kind: "idle",
      message: codigo
        ? "Modelo selecionado. Revise os campos e gere a pré-visualização."
        : undefined,
    });
  };

  const applyPrefill = () => {
    if (!prefillQuery.data) return;
    setFieldValues((prev) => ({ ...prefillQuery.data, ...prev }));
    setPreview({
      kind: "idle",
      message: "Dados da OS/deputado aplicados aos campos.",
    });
  };

  const renderMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCodigo) throw new Error("Selecione um modelo de cartão.");
      const result = await renderPapelariaSvg({
        codigo_modelo: selectedCodigo,
        dados: collectDados(),
      });
      return result;
    },
    onMutate: () => {
      revokePreviewUrl();
      setPreview({ kind: "loading" });
    },
    onSuccess: (result) => {
      const blob = new Blob([result.svg], { type: "image/svg+xml;charset=utf-8" });
      const url = window.URL.createObjectURL(blob);
      previewUrlRef.current = url;
      setPreview({
        kind: "svg",
        url,
        warnings: result.warnings ?? [],
      });
      setMobilePanel("preview");
    },
    onError: (err: Error) => {
      setPreview({
        kind: "error",
        message: err.message || "Erro ao gerar SVG",
      });
    },
  });

  const exportMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCodigo) throw new Error("Selecione um modelo.");
      return exportPapelariaSvg({
        codigo_modelo: selectedCodigo,
        dados: collectDados(),
      });
    },
    onSuccess: (blob) => {
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${selectedCodigo}.svg`;
      a.click();
      window.URL.revokeObjectURL(url);
    },
    onError: (err: Error) => {
      window.alert(err.message || "Erro ao exportar SVG.");
    },
  });

  const mobilePanelClass = (panel: "form" | "preview") =>
    cn(
      mobilePanel !== panel && "max-md:hidden",
      panel === "preview"
        ? "flex min-h-[min(50vh,480px)] min-w-0 flex-1 flex-col md:min-h-0"
        : "flex min-h-[min(50vh,480px)] w-full flex-col md:min-h-0 md:w-[380px] md:shrink-0",
      "max-md:overflow-visible md:overflow-hidden",
    );

  return (
    <div className="flex min-h-min flex-1 flex-col gap-2 md:min-h-0 md:flex-row md:gap-3 md:overflow-hidden">
      <div
        className="flex shrink-0 gap-1 rounded-lg border border-sagra-border bg-white p-1 shadow-sm md:hidden"
        role="tablist"
        aria-label="Painéis do cartão SVG"
      >
        {(
          [
            ["form", "Formulário"],
            ["preview", "Pré-visualização"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mobilePanel === id}
            onClick={() => setMobilePanel(id)}
            className={cn(
              "flex-1 rounded-md px-2 py-1.5 text-[0.7rem] font-semibold transition-colors",
              mobilePanel === id
                ? "bg-secondary-blue text-white"
                : "text-neutral-600 hover:bg-slate-50",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <section
        className={cn(
          mobilePanelClass("form"),
          "rounded-lg border border-sagra-border bg-white shadow-sm",
        )}
      >
        <div className="border-b border-sagra-border bg-slate-50/80 px-3 py-2">
          <h2 className="text-xs font-bold text-secondary-blue">
            Cartão de visita (SVG)
          </h2>
          <p className="text-[10px] text-neutral-500">
            Modelos em <strong>Modelos/</strong> — preenchimento automático pela OS
          </p>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
          <div>
            <label
              htmlFor="svg-modelo-frente"
              className="mb-1 block text-xs font-medium text-neutral-700"
            >
              Modelo (frente / único)
            </label>
            <select
              id="svg-modelo-frente"
              className="w-full rounded border border-sagra-border px-2 py-1.5 text-sm"
              value={selectedCodigo}
              disabled={modelsQuery.isLoading}
              onChange={(e) => handleModelChange(e.target.value)}
            >
              <option value="">
                {modelsQuery.isLoading ? "Carregando..." : "Selecione o modelo..."}
              </option>
              {(modelsQuery.data ?? []).map((m) => (
                <option key={m.codigo} value={m.codigo}>
                  {m.nome}
                  {m.face === "verso" ? " (verso)" : ""}
                </option>
              ))}
            </select>
          </div>

          {hasOs && (
            <button
              type="button"
              className="flex w-full items-center justify-center gap-2 rounded border border-secondary-blue/30 bg-secondary-blue/5 px-2 py-1.5 text-xs font-semibold text-secondary-blue hover:bg-secondary-blue/10 disabled:opacity-50"
              disabled={prefillQuery.isLoading}
              onClick={applyPrefill}
            >
              {prefillQuery.isLoading ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <Sparkles className="size-3.5" aria-hidden />
              )}
              Preencher com dados da OS / deputado
            </button>
          )}

          <hr className="border-neutral-200" />

          <SvgDynamicFields
            fields={fieldsQuery.data}
            isLoading={fieldsQuery.isLoading}
            isError={fieldsQuery.isError}
            hasModel={Boolean(selectedCodigo)}
            values={fieldValues}
            onChange={(key, value) =>
              setFieldValues((prev) => ({ ...prev, [key]: value }))
            }
          />

          <div className="mt-auto flex flex-col gap-2">
            <button
              type="button"
              className="flex w-full items-center justify-center gap-2 rounded bg-secondary-blue px-3 py-2 text-sm font-bold text-white hover:bg-secondary-blue/90 disabled:opacity-60"
              disabled={!selectedCodigo || renderMutation.isPending}
              onClick={() => renderMutation.mutate()}
            >
              {renderMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Eye className="size-4" aria-hidden />
              )}
              Pré-visualizar SVG
            </button>
            <button
              type="button"
              className="flex w-full items-center justify-center gap-2 rounded border border-sagra-border bg-white px-3 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
              disabled={!selectedCodigo || exportMutation.isPending}
              onClick={() => exportMutation.mutate()}
            >
              {exportMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Download className="size-4" aria-hidden />
              )}
              Baixar SVG
            </button>
          </div>
        </div>
      </section>

      <section
        className={cn(
          mobilePanelClass("preview"),
          "rounded-lg border border-sagra-border bg-neutral-100 shadow-sm",
        )}
      >
        <div className="flex items-center justify-between border-b border-sagra-border bg-white px-3 py-2">
          <h2 className="text-xs font-bold text-secondary-blue">Pré-visualização</h2>
          <button
            type="button"
            className="rounded p-1 text-neutral-500 hover:bg-neutral-100"
            title="Atualizar preview"
            disabled={!selectedCodigo || renderMutation.isPending}
            onClick={() => renderMutation.mutate()}
          >
            <RefreshCw className="size-4" aria-hidden />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
          <div
            className={cn(
              "relative flex max-h-full max-w-full items-center justify-center bg-white shadow-lg",
              preview.kind !== "svg" &&
                "min-h-[min(40vh,200px)] min-w-0 border border-dashed border-neutral-300 sm:min-w-[340px]",
            )}
            style={{ aspectRatio: "85 / 50" }}
          >
            <SvgPreviewContent preview={preview} />
          </div>
        </div>

        {preview.kind === "svg" && preview.warnings.length > 0 && (
          <div className="shrink-0 border-t border-amber-200 bg-amber-50 px-3 py-2 text-[10px] text-amber-900">
            {preview.warnings.slice(0, 3).map((w) => (
              <div key={w}>{w}</div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function SvgDynamicFields({
  fields,
  isLoading,
  isError,
  hasModel,
  values,
  onChange,
}: {
  fields: PapelariaField[] | undefined;
  isLoading: boolean;
  isError: boolean;
  hasModel: boolean;
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  if (!hasModel) {
    return (
      <p className="py-4 text-center text-sm text-neutral-500">
        Escolha um modelo de cartão para exibir os campos.
      </p>
    );
  }
  if (isLoading) {
    return (
      <p className="flex items-center justify-center gap-2 py-4 text-sm text-neutral-500">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Carregando campos...
      </p>
    );
  }
  if (isError) {
    return (
      <p className="py-4 text-center text-sm text-sagra-danger">
        Erro ao carregar campos do modelo.
      </p>
    );
  }
  if (!fields?.length) {
    return (
      <p className="py-4 text-center text-sm text-neutral-500">
        Nenhum campo configurado para este modelo.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {fields.map((field) => (
        <div key={field.key}>
          <label className="mb-1 block text-xs font-medium text-neutral-700">
            {field.label}
            {field.required ? " *" : ""}
          </label>
          <input
            type={field.type === "email" ? "email" : "text"}
            className="w-full rounded border border-sagra-border px-2 py-1.5 text-sm"
            value={values[field.key] ?? ""}
            placeholder={field.placeholder ?? field.default ?? ""}
            onChange={(e) => onChange(field.key, e.target.value)}
          />
        </div>
      ))}
    </div>
  );
}

function SvgPreviewContent({ preview }: { preview: SvgPreviewState }) {
  if (preview.kind === "loading") {
    return (
      <div className="p-6 text-center text-sm text-neutral-600">
        <Loader2 className="mx-auto mb-2 size-8 animate-spin text-secondary-blue" />
        Gerando arte...
      </div>
    );
  }
  if (preview.kind === "error") {
    return (
      <div className="p-4 text-center text-sm text-sagra-danger">
        <strong>Erro</strong>
        <br />
        <small>{preview.message}</small>
      </div>
    );
  }
  if (preview.kind === "svg") {
    return (
      <img
        src={preview.url}
        alt="Pré-visualização do cartão de visita"
        className="max-h-full max-w-full object-contain"
      />
    );
  }
  return (
    <p className="p-4 text-center text-sm text-neutral-500">
      {preview.message ?? "Selecione o modelo, preencha os dados e gere a pré-visualização."}
    </p>
  );
}
