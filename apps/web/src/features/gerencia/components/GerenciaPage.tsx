import { useNavigate } from "@tanstack/react-router";
import { Loader2, Save, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useGerenciaOsEditor } from "../hooks/useGerenciaOsEditor";
import { isGerenciaEditMode } from "../mappers";
import type { GerenciaSearchParams } from "../types";
import { GerenciaFormGrid } from "./GerenciaFormGrid";
import { NovaOsArquivosModal } from "./NovaOsArquivosModal";

interface GerenciaPageProps {
  search: GerenciaSearchParams;
}

export function GerenciaPage({ search }: GerenciaPageProps) {
  const navigate = useNavigate();
  const readOnly = search.modo === "detalhes";

  const {
    form,
    update,
    techSpec,
    handleTechSpecChange,
    loading,
    saving,
    save,
    resetToSnapshot,
    deputyPhoto,
    fetchDeputadoIfNeeded,
    loadError,
    ponto,
    aux,
  } = useGerenciaOsEditor({ search, readOnly });

  const [arquivosModal, setArquivosModal] = useState<{
    ano: number;
    osId: number;
  } | null>(null);

  useEffect(() => {
    if (loadError) {
      window.alert("Erro ao carregar dados da OS.");
    }
  }, [loadError]);

  const pageTitle = useMemo(() => {
    if (search.action === "duplicate" && search.ano && search.id) {
      return `Nova OS (Cópia de ${search.id}/${search.ano})`;
    }
    if (search.action === "new") {
      const t = search.type === "papelaria" ? "Papelaria" : "Normal";
      return `Nova Ordem de Serviço (${t})`;
    }
    if (search.ano && search.id) {
      if (readOnly) return `Detalhes da OS ${search.id}/${search.ano} (Somente Leitura)`;
      return `Gerenciamento da OS ${search.id}/${search.ano}`;
    }
    return "Nova Ordem de Serviço";
  }, [readOnly, search]);

  const handleCancel = () => {
    if (readOnly) {
      void navigate({ to: "/" });
      return;
    }
    if (!window.confirm("Tem certeza? Isso desfará todas as alterações.")) return;
    resetToSnapshot();
    void navigate({ to: "/" });
  };

  const handleSave = async () => {
    const wasNewOs = search.action === "new" || search.action === "duplicate";
    const result = await save();
    if (!result) return;
    if (result.status === "ok") {
      const persistAno = result.ano ?? (search.ano ? parseInt(search.ano, 10) : null);
      const persistId = result.id ?? (search.id ? parseInt(search.id, 10) : null);
      const osNum = persistId ?? 0;
      const showArquivosModal =
        wasNewOs && osNum > 0 && osNum < 5000 && persistAno;
      if (showArquivosModal) {
        setArquivosModal({ ano: persistAno, osId: osNum });
        return;
      }
      window.alert(
        result.message ||
          `OS salva com sucesso! (OS: ${result.id}/${result.ano})`,
      );
      void navigate({ to: "/" });
    } else {
      window.alert(result.message || "Erro ao salvar OS.");
    }
  };

  if (loading) {
    return (
      <div className="flex h-0 min-h-0 flex-1 flex-col items-center justify-center gap-3 text-slate-500">
        <Loader2 className="size-8 animate-spin" aria-hidden />
        <p className="text-sm">Carregando gerência da OS…</p>
      </div>
    );
  }

  return (
    <div className="flex h-0 min-h-0 w-full flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-contain px-3 py-3 md:px-4 md:py-4">
      <header className="gerencia-page-header mb-3 shrink-0 border-b border-slate-200/80 pb-3">
        <h1 className="text-lg font-bold text-secondary-blue">{pageTitle}</h1>
        {isGerenciaEditMode(search) ? (
          <p className="text-xs text-slate-500">
            Informações detalhadas da OS
          </p>
        ) : null}
      </header>

      <GerenciaFormGrid
        form={form}
        update={update}
        readOnly={readOnly}
        categorias={aux.categorias}
        produtos={aux.produtos}
        maquinas={aux.maquinas}
        papeis={aux.papeis}
        cores={aux.cores}
        formatos={aux.formatos}
        formasEntrega={aux.formasEntrega}
        responsaveisGrafica={aux.responsaveisGrafica}
        acabamentos={aux.acabamentos}
        techSpec={techSpec}
        onTechSpecChange={handleTechSpecChange}
        deputyPhoto={deputyPhoto}
        onSolicitanteBlur={() => void fetchDeputadoIfNeeded()}
      />

      <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex gap-2">
        <button
          type="button"
          onClick={handleCancel}
          className="pointer-events-auto flex items-center gap-2 rounded-lg border border-red-200 bg-white px-5 py-2.5 text-sm font-semibold text-red-700 shadow-lg transition hover:bg-red-50"
        >
          {readOnly ? (
            <>
              <X className="size-4" aria-hidden />
              Voltar
            </>
          ) : (
            <>
              <X className="size-4" aria-hidden />
              Cancelar
            </>
          )}
        </button>
        {!readOnly ? (
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="pointer-events-auto flex items-center gap-2 rounded-lg bg-primary-green px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:bg-primary-green/90 disabled:opacity-60"
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Save className="size-4" aria-hidden />
            )}
            Salvar
          </button>
        ) : null}
      </div>

      <NovaOsArquivosModal
        open={arquivosModal != null}
        ano={arquivosModal?.ano ?? 0}
        osId={arquivosModal?.osId ?? 0}
        ponto={ponto}
        onDone={() => {
          setArquivosModal(null);
          void navigate({ to: "/" });
        }}
        onClose={() => {
          setArquivosModal(null);
          void navigate({ to: "/" });
        }}
      />
    </div>
  );
}
