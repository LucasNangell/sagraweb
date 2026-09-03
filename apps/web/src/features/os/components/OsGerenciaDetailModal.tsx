import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@sagra/ui";
import {
  Copy,
  FilePlus,
  Link2,
  Loader2,
  Pencil,
  Printer,
  Save,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchOsVinculos } from "@/api/os";
import { queryKeys } from "@/api/query-keys";
import { useAccessControl } from "@/features/auth/useAccessControl";
import { useDevFeature } from "@/features/configuracoes/hooks/useDevFeature";
import {
  GERENCIA_MODAL_SECTIONS,
  renderGerenciaSection,
  type GerenciaSectionId,
} from "@/features/gerencia/components/GerenciaFormSections";
import { NovaOsArquivosModal } from "@/features/gerencia/components/NovaOsArquivosModal";
import { useGerenciaOsEditor } from "@/features/gerencia/hooks/useGerenciaOsEditor";
import { OrcamentoEditorProvider } from "@/features/orcamento/hooks/useOrcamentoEditor";
import { useOsEditLock } from "@/features/os/hooks/useOsEditLock";
import { homeTestIds } from "@/lib/testId";

import {
  confirmNovaOsType,
  gerenciaModalTitle,
  gerenciaSearchForModal,
  isGerenciaModalExistingOnly,
  type OsGerenciaModalMode,
} from "../contextMenuActions";
import { OsGerenciaAuditHistoryPanel } from "./OsGerenciaAuditHistoryPanel";
import { OsSequenciaProducaoTab } from "./OsSequenciaProducaoTab";
import { OsVinculosEditor } from "./OsVinculosEditor";
import type { OsSearchRow } from "../types";

export type GerenciaModalNavId =
  | GerenciaSectionId
  | "sequencia-producao"
  | "historico"
  | "vinculos";

export function buildGerenciaModalNavSections(options: {
  showHistorico: boolean;
  showVinculos: boolean;
  showSequenciaProducao?: boolean;
}): { id: GerenciaModalNavId; label: string }[] {
  return [
    ...GERENCIA_MODAL_SECTIONS,
    ...(options.showSequenciaProducao
      ? [{ id: "sequencia-producao" as const, label: "Sequência de produção" }]
      : []),
    ...(options.showVinculos
      ? [{ id: "vinculos" as const, label: "Vínculos da OS" }]
      : []),
    ...(options.showHistorico
      ? [{ id: "historico" as const, label: "Histórico" }]
      : []),
  ];
}

type ModalSectionId = GerenciaModalNavId;

interface OsGerenciaDetailModalProps {
  row: OsSearchRow | null;
  open: boolean;
  onClose: () => void;
}

const EXISTING_MODE: OsGerenciaModalMode = { kind: "existing" };

export function OsGerenciaDetailModal({
  row,
  open,
  onClose,
}: OsGerenciaDetailModalProps) {
  const { can } = useAccessControl();
  const canEdit = can("ctx_editar_os");
  const canNovaOs = can("ctx_nova_os");
  const canDuplicarOs = can("ctx_duplicar_os");
  const canVincularOs = can("ctx_vincular_os");
  const canPrint = can("ctx_imprimir_ficha");
  const canHistorico = can("ctx_detalhes_os");
  const qc = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<OsGerenciaModalMode>(EXISTING_MODE);
  const [section, setSection] = useState<ModalSectionId>("solicitante");
  const [arquivosModal, setArquivosModal] = useState<{
    ano: number;
    osId: number;
    origemId?: number;
    origemAno?: number;
  } | null>(null);

  const composing = mode.kind !== "existing";
  const formEditable = composing || editing;
  const showHistoricoTab = canHistorico && !composing;
  const sequenciaProducaoEnabled = useDevFeature("sequencia_producao");
  const showSequenciaProducaoTab = sequenciaProducaoEnabled && !composing;
  const vinculosQuery = useQuery({
    queryKey:
      open && row != null && !composing
        ? queryKeys.os.vinculos(row.ano, row.nr_os)
        : ["os", "vinculos", "gerencia-idle"],
    queryFn: () => fetchOsVinculos(row!.ano, row!.nr_os),
    enabled: open && row != null && !composing,
  });
  const showVinculosTab =
    !composing && (vinculosQuery.data?.length ?? 0) > 0;
  const lock = useOsEditLock({
    ano: row?.ano ?? null,
    id: row?.nr_os ?? null,
    origem: "os_edit",
  });

  const search = useMemo(
    () => gerenciaSearchForModal(row, mode),
    [row, mode],
  );

  const {
    form,
    update,
    techSpec,
    handleTechSpecChange,
    loading,
    saving,
    save,
    dirty,
    resetToSnapshot,
    deputyPhoto,
    photoUploading,
    fetchDeputadoIfNeeded,
    uploadSolicitantePhoto,
    loadError,
    ponto,
    aux,
  } = useGerenciaOsEditor({
    search,
    enabled: open && row != null,
    readOnly: !formEditable,
    existingOnly: isGerenciaModalExistingOnly(mode),
  });

  useEffect(() => {
    if (!open) {
      void lock.release();
      setEditing(false);
      setMode(EXISTING_MODE);
      setSection("solicitante");
      setArquivosModal(null);
    }
  }, [open, lock.release]);

  useEffect(() => {
    void lock.release();
    setEditing(false);
    setMode(EXISTING_MODE);
    setSection("solicitante");
  }, [row?.ano, row?.nr_os, lock.release]);

  useEffect(() => {
    if (section === "historico" && !showHistoricoTab) {
      setSection("solicitante");
    }
    if (section === "vinculos" && !showVinculosTab) {
      setSection("solicitante");
    }
    if (section === "sequencia-producao" && !showSequenciaProducaoTab) {
      setSection("solicitante");
    }
  }, [section, showHistoricoTab, showSequenciaProducaoTab, showVinculosTab]);

  const requestClose = useCallback(() => {
    if (arquivosModal) return;
    if (formEditable && dirty) {
      if (
        !window.confirm(
          "Há alterações não salvas. Deseja descartá-las e fechar?",
        )
      ) {
        return;
      }
      resetToSnapshot();
    }
    setEditing(false);
    setMode(EXISTING_MODE);
    void lock.release();
    onClose();
  }, [arquivosModal, dirty, formEditable, onClose, resetToSnapshot, lock.release]);

  const finishCompose = useCallback(() => {
    setEditing(false);
    setMode(EXISTING_MODE);
    setArquivosModal(null);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        requestClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, requestClose]);

  const handleStartEdit = async () => {
    if (!canEdit) return;
    const ok = await lock.acquire();
    if (!ok) return;
    setEditing(true);
  };

  const handleCancelEdit = () => {
    if (dirty) {
      if (!window.confirm("Descartar alterações?")) return;
    }
    void lock.release();
    if (composing) {
      setMode(EXISTING_MODE);
      setSection("solicitante");
      setEditing(false);
      return;
    }
    resetToSnapshot();
    setEditing(false);
  };

  const handleStartNovaOs = () => {
    if (!canNovaOs) return;
    const type = confirmNovaOsType();
    setSection("solicitante");
    setEditing(false);
    setMode({ kind: "new", type });
  };

  const handleStartDuplicarOs = () => {
    if (!canDuplicarOs) return;
    setSection("solicitante");
    setEditing(false);
    setMode({ kind: "duplicate" });
  };

  const handlePrintFicha = () => {
    if (!canPrint) return;
    window.dispatchEvent(new CustomEvent("sagra:os-print-ficha"));
  };

  const handleSave = async () => {
    const result = await save();
    if (!result) return;
    if (result.status !== "ok") {
      window.alert(result.message || "Erro ao salvar OS.");
      return;
    }

    void qc.invalidateQueries({ queryKey: queryKeys.os.searchPrefix });
    if (row) {
      void qc.invalidateQueries({
        queryKey: queryKeys.os.details(row.ano, row.nr_os),
      });
      void qc.invalidateQueries({
        queryKey: queryKeys.os.auditLog(row.ano, row.nr_os),
      });
    }

    if (composing) {
      const persistAno =
        result.ano ?? (search.ano ? parseInt(search.ano, 10) : null);
      const persistId =
        result.id ?? (search.id ? parseInt(search.id, 10) : null);
      const osNum = persistId ?? 0;
      const showArquivosModal =
        osNum > 0 && osNum < 5000 && persistAno != null;
      if (showArquivosModal) {
        setArquivosModal({
          ano: persistAno,
          osId: osNum,
          origemId: mode.kind === "duplicate" && row ? row.nr_os : undefined,
          origemAno: mode.kind === "duplicate" && row ? row.ano : undefined,
        });
        return;
      }
      window.alert(
        result.message ||
          `OS salva com sucesso! (OS: ${result.id}/${result.ano})`,
      );
      finishCompose();
      return;
    }

    setEditing(false);
    window.alert(
      result.message ||
        `OS salva com sucesso! (OS: ${result.id}/${result.ano})`,
    );
    void lock.release();
  };

  if (!open || !row) {
    return null;
  }

  const sectionProps = {
    form,
    update,
    readOnly: !formEditable,
    layout: "modal" as const,
    categorias: aux.categorias,
    produtos: aux.produtos,
    maquinas: aux.maquinas,
    papeis: aux.papeis,
    cores: aux.cores,
    formatos: aux.formatos,
    formasEntrega: aux.formasEntrega,
    responsaveisGrafica: aux.responsaveisGrafica,
    acabamentos: aux.acabamentos,
    techSpec,
    onTechSpecChange: handleTechSpecChange,
    deputyPhoto,
    onSolicitanteBlur: () => void fetchDeputadoIfNeeded(),
    onChangePhoto: (file: File) => void uploadSolicitantePhoto(file),
    photoUploading,
  };

  const navSections = buildGerenciaModalNavSections({
    showHistorico: showHistoricoTab,
    showSequenciaProducao: showSequenciaProducaoTab,
    showVinculos: showVinculosTab,
  });
  const activeLabel =
    navSections.find((s) => s.id === section)?.label ?? "";
  const title = gerenciaModalTitle(row, mode);
  const showComposeActions = !composing && !editing;
  const badgeLabel = composing
    ? mode.kind === "duplicate"
      ? "Cópia"
      : "Novo"
    : editing
      ? "Editando"
      : "Somente leitura";
  const badgeEditing = composing || editing;
  const subtitle =
    form.val_titulo || (mode.kind === "existing" ? row.titulo : null) || "—";

  return (
    <div
      className="fixed inset-0 z-[10002] flex items-center justify-center bg-black/60 p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="os-gerencia-detail-title"
      data-testid={homeTestIds.osGerenciaRoot}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div className="relative flex h-[min(84vh,720px)] w-full max-w-[76.8rem] min-w-0 flex-col overflow-hidden rounded-lg border-t-4 border-[#24344D] bg-white shadow-xl">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-sagra-border px-4 py-2.5 sm:px-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3
                id="os-gerencia-detail-title"
                className="text-lg font-semibold text-secondary-blue"
              >
                {title}
              </h3>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide",
                  badgeEditing
                    ? "bg-amber-100 text-amber-900"
                    : "bg-slate-100 text-slate-600",
                )}
              >
                {badgeLabel}
              </span>
            </div>
            <p className="mt-0.5 truncate text-sm text-neutral-600">
              {subtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={requestClose}
            className="shrink-0 text-neutral-500 hover:text-neutral-800"
            aria-label="Fechar"
            data-testid={homeTestIds.osGerenciaClose}
          >
            <X className="size-5" />
          </button>
        </header>

        <div className="flex min-h-0 min-w-0 flex-1">
          <nav
            className="flex w-40 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-sagra-border bg-slate-50/90 p-1.5 sm:w-44"
            aria-label="Seções da OS"
          >
            {navSections.map((item) => {
              const active = item.id === section;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSection(item.id)}
                  data-testid={homeTestIds.osGerenciaSection(item.id)}
                  className={cn(
                    "rounded-md px-2.5 py-2 text-left text-xs font-semibold transition sm:text-sm",
                    active
                      ? "bg-secondary-blue text-white shadow-sm"
                      : "text-slate-700 hover:bg-white hover:text-secondary-blue",
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <OrcamentoEditorProvider
              ano={form.op_ano || row.ano}
              id={form.op_os || row.nr_os}
              enabled={
                section === "custos" &&
                can("ctx_orcamento") &&
                !loading &&
                mode.kind === "existing"
              }
            >
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 bg-white px-4 py-2">
                <h4 className="text-sm font-bold text-secondary-blue">
                  {activeLabel}
                </h4>
              </div>
              <div
                className={cn(
                  "min-h-0 flex-1 overscroll-contain p-3.5 sm:p-4",
                  section === "material" ||
                    section === "historico" ||
                    section === "sequencia-producao"
                    ? "flex flex-col overflow-hidden"
                    : "overflow-y-auto",
                )}
              >
                {section === "historico" ? (
                  showHistoricoTab ? (
                    <OsGerenciaAuditHistoryPanel
                      ano={row.ano}
                      osId={row.nr_os}
                    />
                  ) : null
                ) : section === "vinculos" ? (
                  showVinculosTab ? (
                    <OsVinculosEditor
                      key={`${row.ano}-${row.nr_os}`}
                      row={row}
                      readOnly={!canVincularOs}
                    />
                  ) : null
                ) : section === "sequencia-producao" ? (
                  showSequenciaProducaoTab ? (
                    <OsSequenciaProducaoTab
                      ano={row.ano}
                      osId={row.nr_os}
                      readOnly={!formEditable}
                      canEdit={canEdit}
                      osDirty={formEditable && dirty}
                    />
                  ) : null
                ) : loading ? (
                  <div className="flex items-center justify-center gap-2 py-16 text-neutral-500">
                    <Loader2 className="size-5 animate-spin" aria-hidden />
                    Carregando dados da OS…
                  </div>
                ) : loadError ? (
                  <p className="py-8 text-center text-sm text-red-600">
                    {loadError}
                  </p>
                ) : (
                  renderGerenciaSection(section as GerenciaSectionId, sectionProps)
                )}
              </div>
            </OrcamentoEditorProvider>
          </div>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-sagra-border bg-slate-50/80 px-4 py-3 sm:px-5">
          <div className="flex flex-wrap gap-2">
            {showComposeActions ? (
              <>
                {canNovaOs ? (
                  <button
                    type="button"
                    onClick={handleStartNovaOs}
                    disabled={loading || !!loadError}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
                    data-testid={homeTestIds.osGerenciaNew}
                  >
                    <FilePlus className="size-4" aria-hidden />
                    Nova OS
                  </button>
                ) : null}
                {canDuplicarOs ? (
                  <button
                    type="button"
                    onClick={handleStartDuplicarOs}
                    disabled={loading || !!loadError}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
                    data-testid={homeTestIds.osGerenciaDuplicate}
                  >
                    <Copy className="size-4" aria-hidden />
                    Duplicar OS
                  </button>
                ) : null}
                {canVincularOs ? (
                  <button
                    type="button"
                    onClick={() =>
                      window.dispatchEvent(new CustomEvent("sagra:os-vincular"))
                    }
                    disabled={loading || !!loadError}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
                    data-testid={homeTestIds.osGerenciaVincular}
                  >
                    <Link2 className="size-4" aria-hidden />
                    Vincular OS
                  </button>
                ) : null}
                {canPrint ? (
                  <button
                    type="button"
                    onClick={handlePrintFicha}
                    disabled={loading || !!loadError}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
                    data-testid={homeTestIds.osGerenciaPrint}
                  >
                    <Printer className="size-4" aria-hidden />
                    Imprimir Ficha
                  </button>
                ) : null}
              </>
            ) : null}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {!formEditable ? (
              <>
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() => void handleStartEdit()}
                    disabled={loading || !!loadError || lock.acquiring}
                    className="inline-flex items-center gap-2 rounded-lg bg-secondary-blue px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-secondary-blue/90 disabled:opacity-50"
                    data-testid={homeTestIds.osGerenciaEdit}
                  >
                    <Pencil className="size-4" aria-hidden />
                    Editar
                  </button>
                ) : null}
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  disabled={saving}
                  className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 shadow-sm transition hover:bg-red-50 disabled:opacity-50"
                  data-testid={homeTestIds.osGerenciaCancel}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary-green px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-green/90 disabled:opacity-60"
                  data-testid={homeTestIds.osGerenciaSave}
                >
                  {saving ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Save className="size-4" aria-hidden />
                  )}
                  Salvar
                </button>
              </>
            )}
          </div>
        </footer>
      </div>

      <NovaOsArquivosModal
        open={arquivosModal != null}
        ano={arquivosModal?.ano ?? 0}
        osId={arquivosModal?.osId ?? 0}
        ponto={ponto}
        origemId={arquivosModal?.origemId}
        origemAno={arquivosModal?.origemAno}
        onDone={finishCompose}
        onClose={finishCompose}
      />
    </div>
  );
}
