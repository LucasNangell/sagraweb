import { cn } from "@sagra/ui";
import { ChevronDown, ChevronRight, FileDown, FileImage, FileText, Layers, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  gravacaoExternaCompositePreviewUrl,
  gravacaoExternaDownloadUrl,
  gravacaoExternaPreviewUrl,
  type GravacaoExternaArquivo,
} from "@/api/gravacaoExterna";
import {
  formatPlatePreviewBadge,
  groupArquivosByCaderno,
  groupArquivosByMaquina,
  isPdfFilename,
  parseChapaLabelFromFilename,
  compareNaturalName,
  PANTONE_CHANNEL_STYLE,
  PLATE_CHANNEL_COLORS,
  PLATE_COLORS,
  type PlateChapaGroup,
  type PlateColor,
} from "@/features/gravacao-externa/utils/plateFilenameUtils";

export interface GravacaoPreviewArquivo {
  id: number;
  nome: string;
  absolute_path?: string | null;
  relative?: string | null;
  maquina?: string | null;
}

export type PreviewSelection =
  | { kind: "file"; arquivo: GravacaoPreviewArquivo }
  | {
      kind: "composite";
      groupKey: string;
      chapaLabel: string | null;
      displayLabel: string;
    };

interface GravacaoExternaPreviewProps {
  ano: number;
  nrOs: number;
  selection: PreviewSelection | null;
  canDownload?: boolean;
  getPreviewUrl?: (ano: number, nrOs: number, arquivoId: number) => string;
  getCompositePreviewUrl?: (ano: number, nrOs: number, groupKey: string) => string;
  getDownloadUrl?: (ano: number, nrOs: number, arquivoId: number) => string;
}

function isPdf(name: string): boolean {
  return name.toLowerCase().endsWith(".pdf");
}

function isTif(name: string): boolean {
  return /\.tiff?$/i.test(name);
}

async function loadPreviewBlobUrl(url: string, mimeType: string): Promise<string> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    throw new Error(`Não foi possível carregar o preview (${res.status}).`);
  }
  const blob = await res.blob();
  const typedBlob = blob.type === mimeType ? blob : new Blob([blob], { type: mimeType });
  return URL.createObjectURL(typedBlob);
}

export function GravacaoExternaPreview({
  ano,
  nrOs,
  selection,
  canDownload = true,
  getPreviewUrl = gravacaoExternaPreviewUrl,
  getCompositePreviewUrl = gravacaoExternaCompositePreviewUrl,
  getDownloadUrl = gravacaoExternaDownloadUrl,
}: GravacaoExternaPreviewProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isComposite = selection?.kind === "composite";
  const arquivo = selection?.kind === "file" ? selection.arquivo : null;
  const plateBadge = isComposite
    ? `${selection.displayLabel} · Composto`
    : arquivo
      ? formatPlatePreviewBadge(arquivo.nome)
      : null;

  useEffect(() => {
    if (!selection) {
      setPreviewUrl(null);
      setError(null);
      return;
    }

    if (selection.kind === "composite") {
      let revoked: string | null = null;
      let cancelled = false;
      setLoading(true);
      setError(null);

      const url = getCompositePreviewUrl(ano, nrOs, selection.groupKey);
      loadPreviewBlobUrl(url, "image/png")
        .then((blobUrl) => {
          if (cancelled) {
            URL.revokeObjectURL(blobUrl);
            return;
          }
          revoked = blobUrl;
          setPreviewUrl(blobUrl);
        })
        .catch((e) => {
          if (!cancelled) {
            setError(e instanceof Error ? e.message : "Falha ao carregar preview composto.");
          }
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false);
          }
        });

      return () => {
        cancelled = true;
        if (revoked) {
          URL.revokeObjectURL(revoked);
        }
      };
    }

    if (!arquivo) {
      return;
    }

    const pdf = isPdf(arquivo.nome);
    const tif = isTif(arquivo.nome);
    if (!pdf && !tif) {
      setPreviewUrl(null);
      setError(null);
      return;
    }

    let revoked: string | null = null;
    let cancelled = false;
    setLoading(true);
    setError(null);

    const url = getPreviewUrl(ano, nrOs, arquivo.id);
    loadPreviewBlobUrl(url, pdf ? "application/pdf" : "image/png")
      .then((blobUrl) => {
        if (cancelled) {
          URL.revokeObjectURL(blobUrl);
          return;
        }
        revoked = blobUrl;
        setPreviewUrl(blobUrl);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Falha ao carregar preview.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      if (revoked) {
        URL.revokeObjectURL(revoked);
      }
    };
  }, [ano, nrOs, selection, arquivo, getPreviewUrl, getCompositePreviewUrl]);

  if (!selection) {
    return (
      <div className="flex h-full min-h-[240px] items-center justify-center rounded-lg border border-dashed border-neutral-300 bg-neutral-50 text-sm text-neutral-500">
        Selecione um arquivo para visualizar
      </div>
    );
  }

  const headerTitle = isComposite
    ? selection.displayLabel
    : arquivo
      ? parseChapaLabelFromFilename(arquivo.nome) ?? arquivo.nome
      : "";
  const headerTooltip = isComposite ? selection.displayLabel : arquivo?.nome;
  const downloadHref =
    canDownload && arquivo ? getDownloadUrl(ano, nrOs, arquivo.id) : null;
  const pdf = arquivo ? isPdf(arquivo.nome) : false;
  const tif = isComposite || (arquivo ? isTif(arquivo.nome) : false);
  const usesAbsolutePath = arquivo ? Boolean(arquivo.absolute_path?.trim()) : false;

  return (
    <div className="flex h-full min-h-0 min-w-0 w-full flex-col rounded-lg border border-neutral-200 bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-neutral-200 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {isComposite ? (
            <Layers className="size-4 shrink-0 text-violet-600" />
          ) : pdf ? (
            <FileText className="size-4 shrink-0 text-red-600" />
          ) : (
            <FileImage className="size-4 shrink-0 text-blue-600" />
          )}
          <span
            className="truncate text-sm font-medium text-neutral-800"
            title={headerTooltip}
          >
            {headerTitle}
          </span>
          {plateBadge ? (
            <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
              {plateBadge}
            </span>
          ) : null}
          {usesAbsolutePath ? (
            <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
              Rede
            </span>
          ) : null}
        </div>
        {downloadHref ? (
          <a
            href={downloadHref}
            className="inline-flex shrink-0 items-center gap-1 rounded border border-neutral-300 px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
          >
            <FileDown className="size-3.5" />
            Download
          </a>
        ) : null}
      </div>

      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-neutral-100">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="size-6 animate-spin text-primary-green" />
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center p-4 text-center text-sm text-red-600">
            {error}
          </div>
        ) : pdf && previewUrl ? (
          <iframe
            title={`Preview ${headerTitle}`}
            src={previewUrl}
            className="h-full w-full border-0"
          />
        ) : tif && previewUrl ? (
          <div className="flex h-full min-h-0 w-full flex-col items-center justify-center overflow-auto p-4">
            <img
              src={previewUrl}
              alt={headerTitle}
              className="block max-h-full max-w-full object-contain shadow-sm"
            />
            {isComposite || plateBadge ? (
              <p className="mt-2 max-w-md text-center text-[10px] text-neutral-500">
                {isComposite
                  ? "Aproximação visual — arquivos originais para gravação"
                  : "Separação de cor — arquivos originais para gravação"}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center p-4 text-center text-sm text-neutral-500">
            Preview indisponível para este arquivo.
          </div>
        )}
      </div>
    </div>
  );
}

function PlateColorChip({
  color,
  compact = false,
}: {
  color: PlateColor;
  compact?: boolean;
}) {
  const styles = PLATE_CHANNEL_COLORS[color];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded border font-bold",
        compact ? "min-w-[1.75rem] px-1.5 py-0.5 text-[10px]" : "min-w-[2rem] px-2 py-0.5 text-xs",
        styles.bg,
        styles.text,
        styles.border,
      )}
    >
      {color}
    </span>
  );
}

function PlateColorRow({
  color,
  file,
  selected,
  onSelect,
  downloadUrl,
}: {
  color: PlateColor;
  file: GravacaoPreviewArquivo | undefined;
  selected: boolean;
  onSelect: () => void;
  downloadUrl?: string;
}) {
  const available = Boolean(file);
  return (
    <button
      type="button"
      disabled={!available}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
        selected
          ? "bg-primary-green/10 text-primary-green ring-1 ring-primary-green/40"
          : available
            ? "text-neutral-800 hover:bg-neutral-50"
            : "cursor-not-allowed opacity-40",
      )}
      title={available ? file!.nome : `${color} indisponivel`}
    >
      <PlateColorChip color={color} compact />
      <span className="min-w-0 flex-1 truncate text-xs font-medium">
        {available ? file!.nome : `${color} — indisponivel`}
      </span>
      {available && downloadUrl ? (
        <a
          href={downloadUrl}
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
          title="Download"
        >
          <FileDown className="size-3.5" />
        </a>
      ) : null}
    </button>
  );
}

function PantoneRow({
  file,
  selected,
  onSelect,
  downloadUrl,
}: {
  file: GravacaoPreviewArquivo;
  selected: boolean;
  onSelect: () => void;
  downloadUrl?: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
        selected
          ? "bg-primary-green/10 text-primary-green ring-1 ring-primary-green/40"
          : "text-neutral-800 hover:bg-neutral-50",
      )}
      title={file.nome}
    >
      <span
        className={cn(
          "inline-flex min-w-[1.75rem] shrink-0 items-center justify-center rounded border px-1.5 py-0.5 text-[10px] font-bold",
          PANTONE_CHANNEL_STYLE.bg,
          PANTONE_CHANNEL_STYLE.text,
          PANTONE_CHANNEL_STYLE.border,
        )}
      >
        PANTONE
      </span>
      <span className="min-w-0 flex-1 truncate text-xs font-medium">{file.nome}</span>
      {downloadUrl ? (
        <a
          href={downloadUrl}
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
          title="Download"
        >
          <FileDown className="size-3.5" />
        </a>
      ) : null}
    </button>
  );
}

function CompositeRow({
  chapaLabel,
  available,
  selected,
  onClick,
}: {
  chapaLabel: string;
  available: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={!available}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
        selected
          ? "bg-primary-green/10 text-primary-green ring-1 ring-primary-green/40"
          : available
            ? "text-neutral-800 hover:bg-neutral-50"
            : "cursor-not-allowed opacity-40",
      )}
      title={
        available
          ? "Preview composto (somente visualizacao)"
          : "Composicao indisponivel (minimo 2 separacoes)"
      }
    >
      <span className="inline-flex min-w-[1.75rem] shrink-0 items-center justify-center rounded border border-violet-400 bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-violet-900">
        Comp.
      </span>
      <span className="min-w-0 flex-1 truncate text-xs font-medium">
        {available ? `${chapaLabel} — composicao` : "Composicao indisponivel"}
      </span>
    </button>
  );
}

function OtherFileRow({
  arq,
  selected,
  onSelect,
  downloadUrl,
}: {
  arq: GravacaoPreviewArquivo;
  selected: boolean;
  onSelect: () => void;
  downloadUrl?: string;
}) {
  const pdf = isPdf(arq.nome);
  const Icon = pdf ? FileText : FileImage;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
        selected
          ? "border-primary-green bg-primary-green/10 text-primary-green"
          : "border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50",
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate font-medium">{arq.nome}</span>
      {downloadUrl ? (
        <a
          href={downloadUrl}
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
          title="Download"
        >
          <FileDown className="size-4" />
        </a>
      ) : null}
    </button>
  );
}

function FaceSeparationsBlock({
  chapa,
  selectedId,
  selectedCompositeGroupKey,
  onSelect,
  onSelectComposite,
  getDownloadUrl,
  ano,
  nrOs,
}: {
  chapa: PlateChapaGroup<GravacaoPreviewArquivo>;
  selectedId: number | null;
  selectedCompositeGroupKey: string | null;
  onSelect: (arq: GravacaoPreviewArquivo) => void;
  onSelectComposite: (chapa: PlateChapaGroup<GravacaoPreviewArquivo>) => void;
  getDownloadUrl?: (ano: number, nrOs: number, arquivoId: number) => string;
  ano: number;
  nrOs: number;
}) {
  const colorsPresent = PLATE_COLORS.filter((c) => chapa.filesByColor[c]);
  const compositeAvailable = colorsPresent.length >= 2;

  return (
    <div className="flex flex-col gap-0.5">
      {colorsPresent.map((color) => {
        const file = chapa.filesByColor[color]!;
        return (
          <PlateColorRow
            key={color}
            color={color}
            file={file}
            selected={file.id === selectedId}
            onSelect={() => onSelect(file)}
            downloadUrl={getDownloadUrl?.(ano, nrOs, file.id)}
          />
        );
      })}
      {chapa.pantoneFiles.map((file) => (
        <PantoneRow
          key={file.id}
          file={file}
          selected={file.id === selectedId}
          onSelect={() => onSelect(file)}
          downloadUrl={getDownloadUrl?.(ano, nrOs, file.id)}
        />
      ))}
      {compositeAvailable ? (
        <CompositeRow
          chapaLabel={chapa.displayLabel}
          available
          selected={chapa.groupKey === selectedCompositeGroupKey}
          onClick={() => onSelectComposite(chapa)}
        />
      ) : null}
    </div>
  );
}

function ArquivosChapaList({
  ano,
  nrOs,
  arquivos,
  selectedId,
  selectedCompositeGroupKey,
  expandedKeys,
  espelhosExpanded,
  onToggleChapa,
  onToggleEspelhos,
  onSelect,
  onSelectComposite,
  getDownloadUrl,
}: {
  ano: number;
  nrOs: number;
  arquivos: GravacaoPreviewArquivo[];
  selectedId: number | null;
  selectedCompositeGroupKey: string | null;
  expandedKeys: Set<string>;
  espelhosExpanded: boolean;
  onToggleChapa: (groupKey: string) => void;
  onToggleEspelhos: () => void;
  onSelect: (arq: GravacaoPreviewArquivo) => void;
  onSelectComposite: (chapa: PlateChapaGroup<GravacaoPreviewArquivo>) => void;
  getDownloadUrl?: (ano: number, nrOs: number, arquivoId: number) => string;
}) {
  const { cadernos, orphanChapas, espelhos, others } = useMemo(
    () => groupArquivosByCaderno(arquivos),
    [arquivos],
  );

  return (
    <div className="flex flex-col gap-2">
      {espelhos.length > 0 ? (
        <div
          className={cn(
            "rounded-lg border bg-white",
            espelhos.some((arq) => arq.id === selectedId)
              ? "border-primary-green/50"
              : "border-neutral-200",
          )}
        >
          <button
            type="button"
            onClick={onToggleEspelhos}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-neutral-800 hover:bg-neutral-50"
          >
            {espelhosExpanded ? (
              <ChevronDown className="size-4 shrink-0 text-neutral-500" />
            ) : (
              <ChevronRight className="size-4 shrink-0 text-neutral-500" />
            )}
            <span className="min-w-0 flex-1 truncate">Espelhos de chapa</span>
            <span className="shrink-0 text-[10px] font-medium text-neutral-500">
              {espelhos.length} PDF{espelhos.length !== 1 ? "s" : ""}
            </span>
          </button>
          {espelhosExpanded ? (
            <div className="flex flex-col gap-0.5 border-t border-neutral-100 px-2 py-2">
              {espelhos.map((arq) => (
                <OtherFileRow
                  key={arq.id}
                  arq={arq}
                  selected={selectedId === arq.id}
                  onSelect={() => onSelect(arq)}
                  downloadUrl={getDownloadUrl?.(ano, nrOs, arq.id)}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {cadernos.map((caderno) => {
        const expanded = expandedKeys.has(caderno.cadernoKey);
        const selectedInCaderno = caderno.faces.some(
          (face) =>
            face.groupKey === selectedCompositeGroupKey ||
            Object.values(face.filesByColor).some((f) => f?.id === selectedId) ||
            face.pantoneFiles.some((f) => f.id === selectedId),
        );
        const chapasCount = caderno.faces.reduce((sum, face) => {
          const cmykCount = PLATE_COLORS.filter((c) => face.filesByColor[c]).length;
          return sum + cmykCount + face.pantoneFiles.length;
        }, 0);

        return (
          <div
            key={caderno.cadernoKey}
            className={cn(
              "rounded-lg border bg-white",
              selectedInCaderno ? "border-primary-green/50" : "border-neutral-200",
            )}
          >
            <button
              type="button"
              onClick={() => onToggleChapa(caderno.cadernoKey)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-neutral-800 hover:bg-neutral-50"
            >
              {expanded ? (
                <ChevronDown className="size-4 shrink-0 text-neutral-500" />
              ) : (
                <ChevronRight className="size-4 shrink-0 text-neutral-500" />
              )}
              <span className="min-w-0 flex-1 truncate">{caderno.displayLabel}</span>
              <span className="shrink-0 text-[10px] font-medium text-neutral-500">
                {chapasCount} chapa{chapasCount === 1 ? "" : "s"}
              </span>
            </button>
            {expanded ? (
              <div className="flex flex-col gap-3 border-t border-neutral-100 px-2 py-2">
                {caderno.faces.map((face) => (
                  <div key={face.groupKey} className="flex flex-col gap-1">
                    <p className="px-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                      {face.faceLabel}
                    </p>
                    <FaceSeparationsBlock
                      chapa={face}
                      selectedId={selectedId}
                      selectedCompositeGroupKey={selectedCompositeGroupKey}
                      onSelect={onSelect}
                      onSelectComposite={onSelectComposite}
                      getDownloadUrl={getDownloadUrl}
                      ano={ano}
                      nrOs={nrOs}
                    />
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}

      {orphanChapas.map((chapa) => {
        const expanded = expandedKeys.has(chapa.groupKey);
        const colorsPresent = PLATE_COLORS.filter((c) => chapa.filesByColor[c]);
        const isIncomplete = colorsPresent.length > 0 && colorsPresent.length < 4;
        const selectedInChapa =
          chapa.groupKey === selectedCompositeGroupKey ||
          Object.values(chapa.filesByColor).some((f) => f?.id === selectedId) ||
          chapa.pantoneFiles.some((f) => f.id === selectedId);

        return (
          <div
            key={chapa.groupKey}
            className={cn(
              "rounded-lg border bg-white",
              selectedInChapa ? "border-primary-green/50" : "border-neutral-200",
            )}
          >
            <button
              type="button"
              onClick={() => onToggleChapa(chapa.groupKey)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-neutral-800 hover:bg-neutral-50"
            >
              {expanded ? (
                <ChevronDown className="size-4 shrink-0 text-neutral-500" />
              ) : (
                <ChevronRight className="size-4 shrink-0 text-neutral-500" />
              )}
              <span className="min-w-0 flex-1 truncate">{chapa.displayLabel}</span>
              {isIncomplete ? (
                <span className="shrink-0 text-[10px] font-medium text-amber-700">
                  {colorsPresent.length}/4
                </span>
              ) : null}
            </button>
            {expanded ? (
              <div className="border-t border-neutral-100 px-2 py-2">
                <FaceSeparationsBlock
                  chapa={chapa}
                  selectedId={selectedId}
                  selectedCompositeGroupKey={selectedCompositeGroupKey}
                  onSelect={onSelect}
                  onSelectComposite={onSelectComposite}
                  getDownloadUrl={getDownloadUrl}
                  ano={ano}
                  nrOs={nrOs}
                />
              </div>
            ) : null}
          </div>
        );
      })}

      {others.length > 0 ? (
        <div className="space-y-1">
          {cadernos.length > 0 || orphanChapas.length > 0 ? (
            <p className="px-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
              Outros
            </p>
          ) : null}
          {others.map((arq) => (
            <OtherFileRow
              key={arq.id}
              arq={arq}
              selected={selectedId === arq.id}
              onSelect={() => onSelect(arq)}
              downloadUrl={getDownloadUrl?.(ano, nrOs, arq.id)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function GravacaoExternaArquivosPanel({
  ano,
  nrOs,
  arquivos,
  selection,
  onSelect,
  onSelectComposite,
  groupByMachine = false,
  chapasPorMaquina,
  canDownload = true,
  getDownloadUrl = gravacaoExternaDownloadUrl,
}: {
  ano: number;
  nrOs: number;
  arquivos: GravacaoPreviewArquivo[] | GravacaoExternaArquivo[];
  selection: PreviewSelection | null;
  onSelect: (arq: GravacaoPreviewArquivo) => void;
  onSelectComposite: (chapa: PlateChapaGroup<GravacaoPreviewArquivo>) => void;
  /** When true, files are listed under machine sections with visual separation. */
  groupByMachine?: boolean;
  /** Optional chapa quantities keyed by machine name (shown in section headers). */
  chapasPorMaquina?: { maquina: string; quantidade: number }[];
  canDownload?: boolean;
  getDownloadUrl?: (ano: number, nrOs: number, arquivoId: number) => string;
}) {
  const chapasQtyByMachine = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of chapasPorMaquina ?? []) {
      const key = String(c.maquina || "").trim().toLowerCase();
      if (key) {
        map.set(key, c.quantidade);
      }
    }
    return map;
  }, [chapasPorMaquina]);

  const machineGroups = useMemo(() => {
    if (!groupByMachine) {
      return null;
    }
    const groups = groupArquivosByMaquina(arquivos);
    const hasNamedMachine = groups.some((g) => g.maquina);
    if (!hasNamedMachine) {
      return null;
    }
    return [...groups].sort((a, b) => {
      if (!a.maquina && b.maquina) return -1;
      if (a.maquina && !b.maquina) return 1;
      if (!a.maquina && !b.maquina) return 0;
      const qtyA = chapasQtyByMachine.get(a.maquina.toLowerCase()) ?? 0;
      const qtyB = chapasQtyByMachine.get(b.maquina.toLowerCase()) ?? 0;
      if (qtyA !== qtyB) return qtyA - qtyB;
      const labelCmp = compareNaturalName(a.label, b.label);
      if (labelCmp !== 0) return labelCmp;
      return a.order - b.order;
    });
  }, [arquivos, groupByMachine, chapasQtyByMachine]);

  const allCadernos = useMemo(() => {
    const source = machineGroups
      ? machineGroups.flatMap((g) => g.arquivos)
      : arquivos;
    return groupArquivosByCaderno(source);
  }, [arquivos, machineGroups]);

  const allEspelhos = allCadernos.espelhos;

  const selectedId = selection?.kind === "file" ? selection.arquivo.id : null;
  const selectedCompositeGroupKey =
    selection?.kind === "composite" ? selection.groupKey : null;

  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set());
  const [espelhosExpanded, setEspelhosExpanded] = useState(true);

  useEffect(() => {
    if (allCadernos.cadernos.length === 0 && allCadernos.orphanChapas.length === 0) {
      setExpandedKeys(new Set());
      return;
    }
    if (selectedId == null && selectedCompositeGroupKey == null) {
      setExpandedKeys(new Set());
      return;
    }

    const cadernoWithSelection = allCadernos.cadernos.find((caderno) =>
      caderno.faces.some(
        (face) =>
          face.groupKey === selectedCompositeGroupKey ||
          Object.values(face.filesByColor).some((f) => f?.id === selectedId) ||
          face.pantoneFiles.some((f) => f.id === selectedId),
      ),
    );
    if (cadernoWithSelection) {
      setExpandedKeys(new Set([cadernoWithSelection.cadernoKey]));
      return;
    }

    const orphanWithSelection = allCadernos.orphanChapas.find(
      (chapa) =>
        chapa.groupKey === selectedCompositeGroupKey ||
        Object.values(chapa.filesByColor).some((f) => f?.id === selectedId) ||
        chapa.pantoneFiles.some((f) => f.id === selectedId),
    );
    if (orphanWithSelection) {
      setExpandedKeys(new Set([orphanWithSelection.groupKey]));
    }
  }, [allCadernos, selectedId, selectedCompositeGroupKey]);

  useEffect(() => {
    if (allEspelhos.some((arq) => arq.id === selectedId)) {
      setEspelhosExpanded(true);
    }
  }, [allEspelhos, selectedId]);

  const toggleChapa = (groupKey: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  };

  if (arquivos.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-4 text-sm text-neutral-500">
        Nenhum arquivo disponibilizado para esta OS.
      </div>
    );
  }

  const listProps = {
    ano,
    nrOs,
    selectedId,
    selectedCompositeGroupKey,
    expandedKeys,
    espelhosExpanded,
    onToggleChapa: toggleChapa,
    onToggleEspelhos: () => setEspelhosExpanded((prev) => !prev),
    onSelect,
    onSelectComposite,
    getDownloadUrl: canDownload ? getDownloadUrl : undefined,
  };

  if (!machineGroups) {
    return (
      <div className="flex flex-col gap-2 overflow-y-auto">
        <ArquivosChapaList {...listProps} arquivos={arquivos} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 overflow-y-auto">
      {machineGroups.map((group) => {
        const registeredQty = group.maquina
          ? chapasQtyByMachine.get(group.maquina.toLowerCase())
          : undefined;
        const filesQty = group.arquivos.filter((arq) => !isPdfFilename(arq.nome)).length;
        const qty = registeredQty ?? (group.maquina ? filesQty : undefined);
        return (
          <section
            key={group.maquina || "__sem_maquina__"}
            className="rounded-lg border border-neutral-300 bg-neutral-50/80"
          >
            <header className="flex items-center justify-between gap-2 border-b border-neutral-200 bg-neutral-100 px-3 py-2">
              <h4 className="min-w-0 truncate text-sm font-semibold text-neutral-900">
                {group.maquina ? group.label : "Espelhos de chapa"}
              </h4>
              {qty != null && qty > 0 ? (
                <span className="shrink-0 text-[10px] font-medium text-neutral-500">
                  {qty} chapa{qty !== 1 ? "s" : ""}
                </span>
              ) : null}
            </header>
            <div className="p-2">
              <ArquivosChapaList {...listProps} arquivos={group.arquivos} />
            </div>
          </section>
        );
      })}
    </div>
  );
}
