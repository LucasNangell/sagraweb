import { useQuery } from "@tanstack/react-query";
import {
  BookCopy,
  CircleDot,
  FileText,
  Folder,
  Loader2,
  RefreshCw,
  Sheet,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";

import {
  fetchProvaWebFiles,
  saveProvaWebRecord,
  type ProvaWebCropJson,
  type ProvaWebFileEntry,
  type ProvaWebInfo,
  type ProvaWebModo,
  type ProvaWebRecord,
} from "@/api/provaWeb";

import { ProvaWebCropAssistant } from "./ProvaWebCropAssistant";
import { ProvaWebExistingModal } from "./ProvaWebExistingModal";
import { defaultEspiralCrop } from "./ProvaWebSpiralWizard";

interface ProvaWebFilePickerProps {
  ano: number;
  osId: number;
  info: ProvaWebInfo;
  onSaved: (record: ProvaWebRecord, portalUrl?: string | null) => void;
  /** Disparado no clique de confirmar, antes do PUT — feedback imediato. */
  onGenerateStarted?: () => void;
  /** Falha após onGenerateStarted (picker pode já ter fechado). */
  onSaveFailed?: (message: string) => void;
  /** Volta ao visualizador da última prova sem gerar nova. */
  onViewExisting?: () => void;
  /** Presente apenas quando já existe registro (permite voltar sem salvar). */
  onCancel?: () => void;
}

type SlotId = "capa" | "miolo";

export function ProvaWebFilePicker({
  ano,
  osId,
  info,
  onSaved,
  onGenerateStarted,
  onSaveFailed,
  onViewExisting,
  onCancel,
}: ProvaWebFilePickerProps) {
  const record = info.record;
  const [modo, setModo] = useState<ProvaWebModo>(record?.modo ?? "unico");
  const [espiralSourceKind, setEspiralSourceKind] = useState<
    "unico" | "capa_miolo"
  >(
    () =>
      record?.cropJson?.espiral?.sourceKind ??
      (record?.modo === "espiral" && record.arquivoCapa && record.arquivoMiolo
        ? "capa_miolo"
        : "unico"),
  );
  const [selUnico, setSelUnico] = useState<string | null>(
    record?.arquivoUnico ?? null,
  );
  const [selCapa, setSelCapa] = useState<string | null>(record?.arquivoCapa ?? null);
  const [selMiolo, setSelMiolo] = useState<string | null>(
    record?.arquivoMiolo ?? null,
  );
  const [activeSlot, setActiveSlot] = useState<SlotId>("capa");
  const isDraft = Boolean(record?.isDraft || record?.status === "rascunho");
  const [phase, setPhase] = useState<"pick" | "crop">(() =>
    isDraft && record?.cropJson ? "crop" : "pick",
  );
  const [pendingCrop, setPendingCrop] = useState<ProvaWebCropJson | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [askExisting, setAskExisting] = useState(false);

  const filesQuery = useQuery({
    queryKey: ["prova-web-files", ano, osId],
    queryFn: () => fetchProvaWebFiles(ano, osId),
    retry: 1,
  });

  const groups = useMemo(() => {
    const map = new Map<string, ProvaWebFileEntry[]>();
    for (const file of filesQuery.data?.files ?? []) {
      const dir = file.dir || "";
      const list = map.get(dir) ?? [];
      list.push(file);
      map.set(dir, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b, "pt-BR"));
  }, [filesQuery.data]);

  const usesCapaMioloSlots =
    modo === "capa_miolo" ||
    (modo === "espiral" && espiralSourceKind === "capa_miolo");
  const usesUnicoSlot =
    modo === "unico" ||
    modo === "folha_dobrada" ||
    (modo === "espiral" && espiralSourceKind === "unico");

  const canConfirm = usesUnicoSlot
    ? Boolean(selUnico)
    : Boolean(selCapa && selMiolo);

  const handlePick = (file: ProvaWebFileEntry) => {
    setSaveError(null);
    if (usesUnicoSlot) {
      setSelUnico(file.path);
      return;
    }
    if (activeSlot === "capa") {
      setSelCapa(file.path);
      if (!selMiolo) {
        setActiveSlot("miolo");
      }
    } else {
      setSelMiolo(file.path);
      if (!selCapa) {
        setActiveSlot("capa");
      }
    }
  };

  const finishSaved = (rec: ProvaWebRecord, portalUrl?: string | null) => {
    onSaved(rec, portalUrl);
  };

  const doSave = async (nova: boolean, cropJson: ProvaWebCropJson) => {
    if (!canConfirm || saving) {
      return;
    }
    setAskExisting(false);
    setSaving(true);
    setSaveError(null);
    // Feedback imediato: a página já mostra "Gerando…" sem esperar o PUT.
    onGenerateStarted?.();
    try {
      const res = await saveProvaWebRecord(ano, osId, {
        modo,
        arquivo_unico: usesUnicoSlot ? selUnico : null,
        arquivo_capa: usesCapaMioloSlots ? selCapa : null,
        arquivo_miolo: usesCapaMioloSlots ? selMiolo : null,
        nova,
        crop_json:
          modo === "espiral"
            ? {
                ...cropJson,
                espiral: {
                  ...(cropJson.espiral ?? defaultEspiralCrop(espiralSourceKind)),
                  sourceKind: espiralSourceKind,
                },
              }
            : cropJson,
      });
      finishSaved(res.record, res.portalUrl);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Erro ao salvar o arquivo da prova.";
      setSaveError(message);
      onSaveFailed?.(message);
    } finally {
      setSaving(false);
    }
  };

  const handleCropConfirm = (cropJson: ProvaWebCropJson) => {
    setPendingCrop(cropJson);
    // Rascunho: regenera a mesma versão. Publicado: pergunta visualizar vs nova.
    if (isDraft) {
      void doSave(false, cropJson);
      return;
    }
    if (record) {
      setAskExisting(true);
      return;
    }
    void doSave(false, cropJson);
  };

  const badgeFor = (file: ProvaWebFileEntry): SlotId | "unico" | null => {
    if (usesUnicoSlot) {
      return selUnico === file.path ? "unico" : null;
    }
    if (selCapa === file.path) return "capa";
    if (selMiolo === file.path) return "miolo";
    return null;
  };

  if (phase === "crop") {
    return (
      <>
        <ProvaWebCropAssistant
          ano={ano}
          osId={osId}
          modo={modo}
          arquivoUnico={usesUnicoSlot ? selUnico : null}
          arquivoCapa={usesCapaMioloSlots ? selCapa : null}
          arquivoMiolo={usesCapaMioloSlots ? selMiolo : null}
          saving={saving}
          formato={info.formato}
          formatoAlturaMm={info.formatoAlturaMm}
          formatoLarguraMm={info.formatoLarguraMm}
          initialCropJson={
            modo === "espiral"
              ? {
                  ...(record?.cropJson ?? {}),
                  espiral: {
                    ...(record?.cropJson?.espiral ??
                      defaultEspiralCrop(espiralSourceKind)),
                    sourceKind: espiralSourceKind,
                  },
                }
              : (record?.cropJson ?? null)
          }
          onBack={() => {
            setPhase("pick");
            setSaveError(null);
          }}
          onConfirm={handleCropConfirm}
        />
        {saveError && (
          <p className="mx-auto max-w-5xl px-4 pb-4 text-sm text-sagra-danger">
            {saveError}
          </p>
        )}
        <ProvaWebExistingModal
          open={askExisting}
          versao={record?.versao ?? 1}
          onCancel={() => {
            setAskExisting(false);
            setPendingCrop(null);
          }}
          onView={() => {
            setAskExisting(false);
            setPendingCrop(null);
            onViewExisting?.();
          }}
          onCreateNew={() => {
            if (pendingCrop) {
              void doSave(true, pendingCrop);
            }
          }}
        />
      </>
    );
  }

  return (
    <>
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-4">
      <div className="rounded-2xl border border-sagra-border bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-neutral-800">
              Selecione o arquivo da prova
            </h2>
            <p className="mt-1 text-xs text-neutral-500">
              {isDraft
                ? `Editando rascunho da Prova ${record?.versao ?? 1}. Ao gerar de novo, os arquivos desta versão serão substituídos.`
                : record
                  ? `Já existe Prova ${record.versao ?? 1} publicada. Selecione os arquivos para criar uma nova versão ou cancele para voltar.`
                  : "Escolha o PDF da pasta da OS. Em seguida você definirá o crop com precisão antes de gerar a Prova WEB."}
            </p>
          </div>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-sagra-border p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
              aria-label="Fechar seleção"
            >
              <X className="size-4" aria-hidden />
            </button>
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <ModeButton
            active={modo === "unico"}
            onClick={() => {
              setModo("unico");
              setSaveError(null);
            }}
            icon={<FileText className="size-3.5" aria-hidden />}
            label="Arquivo único"
          />
          <ModeButton
            active={modo === "capa_miolo"}
            onClick={() => {
              setModo("capa_miolo");
              setSaveError(null);
            }}
            icon={<BookCopy className="size-3.5" aria-hidden />}
            label="Capa + Miolo"
          />
          <ModeButton
            active={modo === "folha_dobrada"}
            onClick={() => {
              setModo("folha_dobrada");
              setSaveError(null);
            }}
            icon={<Sheet className="size-3.5" aria-hidden />}
            label="Folheto dobrado"
          />
          <ModeButton
            active={modo === "espiral"}
            onClick={() => {
              setModo("espiral");
              setSaveError(null);
            }}
            icon={<CircleDot className="size-3.5" aria-hidden />}
            label="Espiral / wire-o"
          />
        </div>

        {modo === "espiral" && (
          <div className="mt-3 space-y-2">
            <p className="text-[11px] text-neutral-500">
              Produto com furos e espiral no mockup 3D. Escolha se a arte vem de
              um PDF único ou de capa + miolo (sem lombada de cola).
            </p>
            <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setEspiralSourceKind("unico");
                setSaveError(null);
              }}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                espiralSourceKind === "unico"
                  ? "bg-primary-green/15 text-primary-green ring-1 ring-primary-green/40"
                  : "bg-slate-100 text-neutral-600 hover:bg-slate-200"
              }`}
            >
              Arquivo único
            </button>
            <button
              type="button"
              onClick={() => {
                setEspiralSourceKind("capa_miolo");
                setSaveError(null);
              }}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                espiralSourceKind === "capa_miolo"
                  ? "bg-primary-green/15 text-primary-green ring-1 ring-primary-green/40"
                  : "bg-slate-100 text-neutral-600 hover:bg-slate-200"
              }`}
            >
              Capa + Miolo
            </button>
            </div>
          </div>
        )}

        {usesCapaMioloSlots ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <SlotCard
              label="Capa"
              value={selCapa}
              active={activeSlot === "capa"}
              onActivate={() => setActiveSlot("capa")}
              onClear={() => setSelCapa(null)}
            />
            <SlotCard
              label="Miolo"
              value={selMiolo}
              active={activeSlot === "miolo"}
              onActivate={() => setActiveSlot("miolo")}
              onClear={() => setSelMiolo(null)}
            />
          </div>
        ) : (
          <div className="mt-3">
            <SlotCard
              label="Prova"
              value={selUnico}
              active
              onClear={() => setSelUnico(null)}
            />
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-sagra-border bg-white shadow-sm">
        <div className="border-b border-sagra-border bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
          PDFs na pasta da OS
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {filesQuery.isLoading && (
            <div className="flex flex-col items-center gap-2 p-8 text-neutral-500">
              <Loader2 className="size-6 animate-spin text-primary-green" aria-hidden />
              <p className="text-xs">Lendo a pasta da OS na rede…</p>
            </div>
          )}

          {filesQuery.isError && (
            <div className="flex flex-col items-center gap-3 p-8 text-center">
              <p className="text-sm text-sagra-danger">
                {filesQuery.error instanceof Error
                  ? filesQuery.error.message
                  : "Erro ao listar a pasta da OS."}
              </p>
              <button
                type="button"
                onClick={() => void filesQuery.refetch()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-sagra-border px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-100"
              >
                <RefreshCw className="size-3.5" aria-hidden />
                Tentar novamente
              </button>
            </div>
          )}

          {filesQuery.data && filesQuery.data.files.length === 0 && (
            <p className="p-8 text-center text-sm text-neutral-500">
              Nenhum PDF encontrado na pasta da OS.
            </p>
          )}

          {groups.map(([dir, files]) => (
            <div key={dir || "(raiz)"} className="mb-1">
              <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-neutral-500">
                <Folder className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">{dir || "Pasta da OS (raiz)"}</span>
              </div>
              {files.map((file) => {
                const badge = badgeFor(file);
                return (
                  <button
                    key={file.path}
                    type="button"
                    onClick={() => handlePick(file)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition ${
                      badge
                        ? "bg-primary-green/10 ring-1 ring-primary-green/40"
                        : "hover:bg-neutral-100"
                    }`}
                  >
                    <FileText
                      className="size-4 shrink-0 text-neutral-400"
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate text-sm text-neutral-800">
                      {file.name}
                    </span>
                    {badge && (
                      <span className="shrink-0 rounded-full bg-primary-green/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-green-700">
                        {badge === "unico" ? "Selecionado" : badge}
                      </span>
                    )}
                    <span className="shrink-0 text-xs tabular-nums text-neutral-400">
                      {formatSize(file.size)}
                    </span>
                    <span className="hidden shrink-0 text-xs text-neutral-400 sm:inline">
                      {formatDate(file.modifiedAt)}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}

          {filesQuery.data?.truncated && (
            <p className="px-2 py-2 text-center text-xs text-neutral-500">
              Lista truncada — há mais arquivos na pasta.
            </p>
          )}
        </div>
      </div>

      {saveError && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-sagra-danger">
          {saveError}
        </p>
      )}

      <div className="flex items-center justify-end gap-2 pb-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-sagra-border bg-white px-4 py-2 text-sm text-neutral-700 shadow-sm hover:bg-neutral-100"
          >
            Cancelar
          </button>
        )}
        <button
          type="button"
          disabled={!canConfirm}
          onClick={() => {
            setSaveError(null);
            setPhase("crop");
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-primary-green px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Continuar
        </button>
      </div>
    </div>
    </>
  );
}

function ModeButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
        active
          ? "border-primary-green bg-primary-green/10 text-green-700"
          : "border-sagra-border bg-white text-neutral-600 hover:bg-neutral-100"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function SlotCard({
  label,
  value,
  active,
  onActivate,
  onClear,
}: {
  label: string;
  value: string | null;
  active: boolean;
  onActivate?: () => void;
  onClear: () => void;
}) {
  return (
    <div
      role={onActivate ? "button" : undefined}
      tabIndex={onActivate ? 0 : undefined}
      onClick={onActivate}
      onKeyDown={(e) => {
        if (onActivate && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onActivate();
        }
      }}
      className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${
        active
          ? "border-primary-green/60 bg-primary-green/5"
          : "border-sagra-border bg-slate-50"
      } ${onActivate ? "cursor-pointer" : ""}`}
    >
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
          {label}
        </p>
        <p className="truncate text-sm text-neutral-800">
          {value ?? (
            <span className="text-neutral-400">
              Clique em um PDF da lista para selecionar
            </span>
          )}
        </p>
      </div>
      {value && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
          className="rounded-md p-1 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-600"
          aria-label={`Limpar ${label}`}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
    });
  } catch {
    return "";
  }
}
