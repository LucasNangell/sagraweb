import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, FileText, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { fetchOsVersions } from "@/api/analise";
import {
  fetchAnaliseLabFiles,
  type AnaliseLabComponente,
  type AnaliseLabFileEntry,
  type AnaliseLabFonte,
  type SaveAnaliseLabPayload,
} from "@/api/analiseLab";

import {
  assignFonte,
  canGenerateLabFontes,
  deriveLegacyPaths,
  fontesForComponent,
  identityLabCropJson,
  moveFonte,
  seedLabFontes,
} from "./analiseLabFontes";
import {
  defaultFolhearModo,
  normalizeFolhearModo,
  type AnaliseLabFolhearModo,
} from "./analiseLabFolhearModo";

interface AnaliseLabSourcePickerProps {
  ano: number;
  osId: number;
  saving?: boolean;
  initialVersaoLabel?: string | null;
  initialModo?: "unico" | "capa_miolo" | null;
  initialFontes?: AnaliseLabFonte[] | null;
  initialArquivoUnico?: string | null;
  initialArquivoCapa?: string | null;
  initialArquivoMiolo?: string | null;
  initialFolhearModo?: AnaliseLabFolhearModo | null;
  onGenerate: (payload: SaveAnaliseLabPayload) => void;
  onGenerateStarted?: () => void;
}

export function AnaliseLabSourcePicker({
  ano,
  osId,
  saving = false,
  initialVersaoLabel = null,
  initialModo = null,
  initialFontes = null,
  initialArquivoUnico = null,
  initialArquivoCapa = null,
  initialArquivoMiolo = null,
  initialFolhearModo = null,
  onGenerate,
  onGenerateStarted,
}: AnaliseLabSourcePickerProps) {
  const versionsQuery = useQuery({
    queryKey: ["analise-lab-versions", ano, osId],
    queryFn: () => fetchOsVersions(ano, osId),
    retry: 1,
  });

  const versions = versionsQuery.data?.versions ?? [];
  const [versaoLabel, setVersaoLabel] = useState(initialVersaoLabel || "");
  const [modo, setModo] = useState<"unico" | "capa_miolo">(
    initialModo === "capa_miolo" ? "capa_miolo" : "unico",
  );
  const [folhearModo, setFolhearModo] = useState<AnaliseLabFolhearModo>(() =>
    initialFolhearModo
      ? normalizeFolhearModo(initialFolhearModo, initialModo)
      : defaultFolhearModo(initialModo),
  );
  const [fontes, setFontes] = useState<AnaliseLabFonte[]>(() =>
    initialFontes && initialFontes.length
      ? initialFontes
      : initialArquivoUnico || initialArquivoCapa || initialArquivoMiolo
        ? [
            ...(initialArquivoCapa
              ? [{ path: initialArquivoCapa, componente: "Capa" as const, ordem: 0 }]
              : []),
            ...(initialArquivoMiolo
              ? [{ path: initialArquivoMiolo, componente: "Miolo" as const, ordem: 0 }]
              : []),
            ...(initialArquivoUnico
              ? [
                  {
                    path: initialArquivoUnico,
                    componente: "Arq. Único" as const,
                    ordem: 0,
                  },
                ]
              : []),
          ]
        : [],
  );
  const [seededFor, setSeededFor] = useState("");

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

  useEffect(() => {
    if (!files.length || !versaoLabel) return;
    const key = `${versaoLabel}::${modo}`;
    if (seededFor === key) return;
    const validPaths = new Set(files.map((f) => f.path));
    const kept = fontes.filter((f) => validPaths.has(f.path));
    if (kept.length) {
      setFontes(kept);
    } else {
      setFontes(seedLabFontes(files, modo));
    }
    setSeededFor(key);
    // Seed only when versão/modo/lista mudam.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fontes is source, not trigger
  }, [files, versaoLabel, modo, seededFor]);

  const assignedPaths = useMemo(() => new Set(fontes.map((f) => f.path)), [fontes]);
  const pool = files.filter((f) => !assignedPaths.has(f.path));
  const canGenerate = canGenerateLabFontes(fontes, modo) && Boolean(versaoLabel);

  const slots: AnaliseLabComponente[] =
    modo === "capa_miolo" ? ["Capa", "Miolo"] : ["Arq. Único"];

  const handleGenerate = () => {
    const legacy = deriveLegacyPaths(fontes, modo);
    onGenerateStarted?.();
    onGenerate({
      versao_label: versaoLabel,
      modo,
      ...legacy,
      fontes,
      crop_json: identityLabCropJson(modo),
      folhear_modo: folhearModo,
    });
  };

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-4 overflow-hidden p-6">
      <div>
        <h2 className="text-lg font-semibold text-secondary-blue">
          Análise Lab — fontes
        </h2>
        <p className="text-sm text-neutral-600">
          Atribua os PDFs a cada componente e defina a ordem de montagem. O corte
          é feito depois, na ferramenta Crop da inspeção.
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
            setSeededFor("");
            setFontes([]);
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
          onClick={() => {
            setModo("unico");
            setFolhearModo(defaultFolhearModo("unico"));
            setSeededFor("");
            setFontes([]);
          }}
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
          onClick={() => {
            setModo("capa_miolo");
            setFolhearModo(defaultFolhearModo("capa_miolo"));
            setSeededFor("");
            setFontes([]);
          }}
          className={
            modo === "capa_miolo"
              ? "rounded bg-primary-green px-3 py-1.5 text-sm text-white"
              : "rounded border border-sagra-border px-3 py-1.5 text-sm"
          }
        >
          Capa + miolo
        </button>
      </div>

      {filesQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-neutral-600">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Listando PDFs…
        </div>
      ) : null}

      <section className="rounded border border-sagra-border bg-white p-3">
        <h3 className="text-sm font-semibold text-neutral-800">
          Exibição no Folhear
        </h3>
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
              name="analise-lab-folhear-modo"
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
              name="analise-lab-folhear-modo"
              className="sr-only"
              checked={folhearModo === "folhas"}
              onChange={() => setFolhearModo("folhas")}
            />
            Folhas separadas
          </label>
        </div>
      </section>

      <div className="grid min-h-0 flex-1 gap-3 overflow-hidden md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <FileColumn title="Não usados" empty="Nenhum PDF restante.">
          {pool.map((file) => (
            <PoolRow
              key={file.path}
              file={file}
              modo={modo}
              onAssign={(componente) =>
                setFontes((prev) => assignFonte(prev, file.path, componente))
              }
            />
          ))}
        </FileColumn>

        <div className="grid min-h-0 gap-3 overflow-hidden">
          {slots.map((componente) => {
            const slotFiles = fontesForComponent(fontes, componente);
            return (
              <FileColumn
                key={componente}
                title={componente}
                empty="Arraste ou atribua arquivos a este componente."
              >
                {slotFiles.map((fonte, index) => (
                  <AssignedRow
                    key={fonte.path}
                    name={fileName(fonte.path, files)}
                    path={fonte.path}
                    canUp={index > 0}
                    canDown={index < slotFiles.length - 1}
                    onUp={() => setFontes((prev) => moveFonte(prev, fonte.path, -1))}
                    onDown={() => setFontes((prev) => moveFonte(prev, fonte.path, 1))}
                    onRemove={() =>
                      setFontes((prev) => assignFonte(prev, fonte.path, null))
                    }
                  />
                ))}
              </FileColumn>
            );
          })}
        </div>
      </div>

      <button
        type="button"
        disabled={!canGenerate || saving}
        onClick={handleGenerate}
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-secondary-blue px-4 py-2.5 text-sm font-semibold text-white hover:bg-secondary-blue/90 disabled:opacity-50"
      >
        {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        Gerar visualização
      </button>
    </div>
  );
}

function fileName(path: string, files: AnaliseLabFileEntry[]): string {
  return files.find((f) => f.path === path)?.name || path.split("/").pop() || path;
}

function FileColumn({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: ReactNode;
}) {
  const hasChildren = Array.isArray(children)
    ? children.length > 0
    : Boolean(children);
  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded border border-sagra-border bg-white">
      <h3 className="shrink-0 bg-neutral-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-600">
        {title}
      </h3>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {hasChildren ? children : (
          <li className="px-3 py-4 text-xs text-neutral-500">{empty}</li>
        )}
      </ul>
    </section>
  );
}

function PoolRow({
  file,
  modo,
  onAssign,
}: {
  file: AnaliseLabFileEntry;
  modo: "unico" | "capa_miolo";
  onAssign: (componente: AnaliseLabComponente) => void;
}) {
  const options: AnaliseLabComponente[] =
    modo === "capa_miolo" ? ["Capa", "Miolo"] : ["Arq. Único"];
  return (
    <li className="flex items-center gap-2 border-b border-sagra-border px-3 py-2 last:border-0">
      <FileText className="size-4 shrink-0 text-neutral-500" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-sm">{file.name}</span>
      {options.map((comp) => (
        <button
          key={comp}
          type="button"
          onClick={() => onAssign(comp)}
          className="rounded border border-sagra-border px-1.5 py-0.5 text-[11px] hover:bg-neutral-50"
        >
          {comp === "Arq. Único" ? "Usar" : comp}
        </button>
      ))}
    </li>
  );
}

function AssignedRow({
  name,
  path,
  canUp,
  canDown,
  onUp,
  onDown,
  onRemove,
}: {
  name: string;
  path: string;
  canUp: boolean;
  canDown: boolean;
  onUp: () => void;
  onDown: () => void;
  onRemove: () => void;
}) {
  return (
    <li className="flex items-center gap-1 border-b border-sagra-border px-2 py-1.5 last:border-0">
      <FileText className="size-4 shrink-0 text-neutral-500" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-sm" title={path}>
        {name}
      </span>
      <button
        type="button"
        disabled={!canUp}
        onClick={onUp}
        className="rounded border border-sagra-border p-0.5 disabled:opacity-30"
        title="Subir na ordem"
        aria-label="Subir na ordem"
      >
        <ArrowUp className="size-3.5" aria-hidden />
      </button>
      <button
        type="button"
        disabled={!canDown}
        onClick={onDown}
        className="rounded border border-sagra-border p-0.5 disabled:opacity-30"
        title="Descer na ordem"
        aria-label="Descer na ordem"
      >
        <ArrowDown className="size-3.5" aria-hidden />
      </button>
      <button
        type="button"
        onClick={onRemove}
        className="rounded px-1.5 py-0.5 text-[11px] text-neutral-600 hover:bg-neutral-50"
      >
        Remover
      </button>
    </li>
  );
}
