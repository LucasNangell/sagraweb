import { useQuery } from "@tanstack/react-query";
import { FileText, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { fetchOsVersions } from "@/api/analise";
import {
  fetchAnaliseLabFiles,
  type AnaliseLabFileEntry,
  type SaveAnaliseLabPayload,
} from "@/api/analiseLab";
import type { ProvaWebCropJson } from "@/api/provaWeb";

import { AnaliseLabCropAssistant } from "./AnaliseLabCropAssistant";

interface AnaliseLabSourcePickerProps {
  ano: number;
  osId: number;
  saving?: boolean;
  formato?: string | null;
  formatoAlturaMm?: number | null;
  formatoLarguraMm?: number | null;
  initialVersaoLabel?: string | null;
  initialModo?: "unico" | "capa_miolo" | null;
  initialArquivoUnico?: string | null;
  initialArquivoCapa?: string | null;
  initialArquivoMiolo?: string | null;
  initialCropJson?: ProvaWebCropJson | null;
  onGenerate: (payload: SaveAnaliseLabPayload) => void;
  onGenerateStarted?: () => void;
}

export function AnaliseLabSourcePicker({
  ano,
  osId,
  saving = false,
  formato = null,
  formatoAlturaMm = null,
  formatoLarguraMm = null,
  initialVersaoLabel = null,
  initialModo = null,
  initialArquivoUnico = null,
  initialArquivoCapa = null,
  initialArquivoMiolo = null,
  initialCropJson = null,
  onGenerate,
  onGenerateStarted,
}: AnaliseLabSourcePickerProps) {
  const versionsQuery = useQuery({
    queryKey: ["analise-lab-versions", ano, osId],
    queryFn: () => fetchOsVersions(ano, osId),
    retry: 1,
  });

  const versions = versionsQuery.data?.versions ?? [];
  const [phase, setPhase] = useState<"pick" | "crop">("pick");
  const [versaoLabel, setVersaoLabel] = useState(initialVersaoLabel || "");
  const [modo, setModo] = useState<"unico" | "capa_miolo">(
    initialModo === "capa_miolo" ? "capa_miolo" : "unico",
  );
  const [selUnico, setSelUnico] = useState<string | null>(
    initialArquivoUnico || null,
  );
  const [selCapa, setSelCapa] = useState<string | null>(
    initialArquivoCapa || null,
  );
  const [selMiolo, setSelMiolo] = useState<string | null>(
    initialArquivoMiolo || null,
  );

  useEffect(() => {
    if (!versaoLabel && versions.length) {
      setVersaoLabel(versions[versions.length - 1]?.label || "");
    }
  }, [versions, versaoLabel]);

  const filesQuery = useQuery({
    queryKey: ["analise-lab-files", ano, osId, versaoLabel],
    queryFn: () => fetchAnaliseLabFiles(ano, osId, versaoLabel),
    enabled: Boolean(versaoLabel),
    retry: 1,
  });

  const files = filesQuery.data?.files ?? [];
  const canContinue =
    modo === "unico" ? Boolean(selUnico) : Boolean(selCapa && selMiolo);

  const groups = useMemo(() => {
    const map = new Map<string, AnaliseLabFileEntry[]>();
    for (const file of files) {
      const list = map.get(file.dir) ?? [];
      list.push(file);
      map.set(file.dir, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b, "pt-BR"));
  }, [files]);

  if (phase === "crop") {
    return (
      <AnaliseLabCropAssistant
        ano={ano}
        osId={osId}
        modo={modo}
        arquivoUnico={selUnico}
        arquivoCapa={selCapa}
        arquivoMiolo={selMiolo}
        saving={saving}
        onBack={() => setPhase("pick")}
        formato={formato}
        formatoAlturaMm={formatoAlturaMm}
        formatoLarguraMm={formatoLarguraMm}
        initialCropJson={initialCropJson}
        onConfirm={(cropJson) => {
          onGenerateStarted?.();
          onGenerate({
            versao_label: versaoLabel,
            modo,
            arquivo_unico: modo === "unico" ? selUnico : null,
            arquivo_capa: modo === "capa_miolo" ? selCapa : null,
            arquivo_miolo: modo === "capa_miolo" ? selMiolo : null,
            crop_json: cropJson,
          });
        }}
      />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-6">
      <div>
        <h2 className="text-lg font-semibold text-secondary-blue">
          Análise Lab — fontes
        </h2>
        <p className="text-sm text-neutral-600">
          Escolha a versão Original e o(s) PDF(s). Em seguida configure o corte
          (lombada e orelhas, se houver capa).
        </p>
      </div>

      {versionsQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-neutral-600">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Carregando versões…
        </div>
      ) : null}

      {versionsQuery.isError ? (
        <p className="text-sm text-sagra-danger">
          {versionsQuery.error instanceof Error
            ? versionsQuery.error.message
            : "Erro ao carregar versões."}
        </p>
      ) : null}

      <label className="flex flex-col gap-1 text-sm">
        Versão (pasta Original)
        <select
          value={versaoLabel}
          onChange={(e) => {
            setVersaoLabel(e.target.value);
            setSelUnico(null);
            setSelCapa(null);
            setSelMiolo(null);
          }}
          className="rounded border border-sagra-border px-3 py-2"
        >
          {!versions.length ? <option value="">Nenhuma versão</option> : null}
          {versions.map((v) => (
            <option key={v.label} value={v.label}>
              {v.label}
            </option>
          ))}
        </select>
      </label>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setModo("unico")}
          className={
            modo === "unico"
              ? "rounded bg-primary-green px-3 py-1.5 text-sm text-white"
              : "rounded border border-sagra-border px-3 py-1.5 text-sm"
          }
        >
          Arquivo único
        </button>
        <button
          type="button"
          onClick={() => setModo("capa_miolo")}
          className={
            modo === "capa_miolo"
              ? "rounded bg-primary-green px-3 py-1.5 text-sm text-white"
              : "rounded border border-sagra-border px-3 py-1.5 text-sm"
          }
        >
          Capa + miolo
        </button>
      </div>

      {modo === "capa_miolo" ? (
        <p className="text-xs text-neutral-500">
          Selecione capa ({selCapa || "—"}) e miolo ({selMiolo || "—"}).
        </p>
      ) : (
        <p className="text-xs text-neutral-500">
          Selecionado: {selUnico || "—"}.
        </p>
      )}

      <div className="max-h-80 overflow-y-auto rounded border border-sagra-border bg-white">
        {filesQuery.isLoading ? (
          <div className="flex items-center gap-2 p-4 text-sm text-neutral-600">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Listando PDFs…
          </div>
        ) : null}
        {groups.map(([dir, list]) => (
          <div key={dir || "/"} className="border-b border-sagra-border last:border-0">
            <div className="bg-neutral-50 px-3 py-1.5 text-xs font-medium text-neutral-600">
              {dir || "/"}
            </div>
            <ul>
              {list.map((file) => {
                const selected =
                  (modo === "unico" && selUnico === file.path) ||
                  selCapa === file.path ||
                  selMiolo === file.path;
                return (
                  <li key={file.path}>
                    <button
                      type="button"
                      onClick={() => {
                        if (modo === "unico") {
                          setSelUnico(file.path);
                          return;
                        }
                        if (!selCapa || (selCapa && selMiolo)) {
                          setSelCapa(file.path);
                          setSelMiolo(null);
                        } else {
                          setSelMiolo(file.path);
                        }
                      }}
                      className={
                        selected
                          ? "flex w-full items-center gap-2 bg-primary-green/10 px-3 py-2 text-left text-sm"
                          : "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-neutral-50"
                      }
                    >
                      <FileText className="size-4 shrink-0 text-neutral-500" aria-hidden />
                      <span className="truncate">{file.name}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {!filesQuery.isLoading && !files.length ? (
          <p className="p-4 text-sm text-neutral-500">Nenhum PDF nesta versão.</p>
        ) : null}
      </div>

      <button
        type="button"
        disabled={!canContinue || saving || !versaoLabel}
        onClick={() => setPhase("crop")}
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-secondary-blue px-4 py-2.5 text-sm font-semibold text-white hover:bg-secondary-blue/90 disabled:opacity-50"
      >
        Continuar para configuração de corte
      </button>
    </div>
  );
}
