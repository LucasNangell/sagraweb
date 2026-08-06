import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Coins, Loader2, Play, RefreshCw, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  fetchCotasGrafSemestreConfig,
  importCotasGraficaRapidaXls,
  iniciarNovoSemestreCotasGraf,
  recalcularCotasGrafSemestre,
} from "@/api/adminSystem";
import type { IniciarNovoSemestrePayload } from "@/features/configuracoes/types";

import {
  ConfigLoadingState,
  ConfigSection,
  ConfigSectionBody,
  ConfigSectionHeader,
  ConfigSubsection,
} from "./ConfigSectionLayout";

function formatSemestreLabel(ano: number, numero: number): string {
  return `${ano}/${numero}º semestre`;
}

function toDateInputValue(value?: string | null): string {
  if (!value) return "";
  return value.slice(0, 10);
}

const emptyForm: IniciarNovoSemestrePayload = {
  ano: new Date().getFullYear(),
  numero_semestre: 1,
  data_inicio: "",
  data_fim: "",
  limite_os_deputado: 120_000,
  limite_sp_deputado: 10_000,
};

export function CotasGrafSettingsSection() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["admin", "cotas-graf-semestre"],
    queryFn: fetchCotasGrafSemestreConfig,
  });

  const [form, setForm] = useState<IniciarNovoSemestrePayload>(emptyForm);
  const [importForce, setImportForce] = useState(false);
  const [lastImportSummary, setLastImportSummary] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const sugerido = query.data?.proximo_semestre;
    if (!sugerido) return;
    setForm({
      ano: sugerido.ano,
      numero_semestre: sugerido.numero_semestre,
      data_inicio: toDateInputValue(sugerido.data_inicio),
      data_fim: toDateInputValue(sugerido.data_fim),
      limite_os_deputado: sugerido.limite_os_deputado,
      limite_sp_deputado: sugerido.limite_sp_deputado,
    });
  }, [query.data?.proximo_semestre]);

  const iniciarMutation = useMutation({
    mutationFn: iniciarNovoSemestreCotasGraf,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "cotas-graf-semestre"] });
      void qc.invalidateQueries({ queryKey: ["cotasGraf"] });
      window.alert("Novo semestre iniciado com sucesso.");
    },
    onError: (err: Error) => {
      window.alert(err.message || "Não foi possível iniciar o novo semestre.");
    },
  });

  const importMutation = useMutation({
    mutationFn: ({ file, force }: { file: File; force: boolean }) =>
      importCotasGraficaRapidaXls(file, force),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ["cotasGraf"] });
      setLastImportSummary(
        `${data.inseridos} consumo(s) importado(s), ${data.duplicados} duplicado(s), ${data.rejeitados} rejeitado(s).`,
      );
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    onError: (err: Error) => {
      window.alert(err.message || "Não foi possível importar a planilha.");
    },
  });

  const recalcularMutation = useMutation({
    mutationFn: recalcularCotasGrafSemestre,
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ["cotasGraf"] });
      window.alert(
        `Cotas recalculadas.\n\n` +
          `Movimentos sincronizados: ${data.movimentos_inseridos.toLocaleString("pt-BR")}\n` +
          `Clientes atualizados: ${data.clientes_atualizados.toLocaleString("pt-BR")}`,
      );
    },
    onError: (err: Error) => {
      window.alert(err.message || "Não foi possível recalcular as cotas.");
    },
  });

  const semestre = query.data?.semestre;

  const handleIniciar = () => {
    if (!semestre) return;
    if (!form.data_inicio || !form.data_fim) {
      window.alert("Informe o período do novo semestre.");
      return;
    }
    const ok = window.confirm(
      `Confirma iniciar um novo semestre?\n\n` +
        `Semestre atual (será fechado): ${formatSemestreLabel(semestre.ano, semestre.numero_semestre)}\n` +
        `Novo semestre: ${formatSemestreLabel(form.ano, form.numero_semestre)}\n` +
        `Período: ${form.data_inicio} a ${form.data_fim}\n` +
        `Limites Deputado OS/SP: ${form.limite_os_deputado.toLocaleString("pt-BR")} / ${form.limite_sp_deputado.toLocaleString("pt-BR")}\n\n` +
        `O consumo dos clientes reinicia no novo semestre; o histórico anterior permanece registrado.`,
    );
    if (!ok) return;
    iniciarMutation.mutate(form);
  };

  const handleImportFile = (file: File | undefined) => {
    if (!file) return;
    const ok = window.confirm(
      `Importar consumo da Gráfica Rápida?\n\n` +
        `Arquivo: ${file.name}\n\n` +
        `Cada PA será vinculado ao deputado correspondente (sem duplicar PAs já importados). ` +
        `Linhas com solicitante ambíguo ou não identificado serão rejeitadas.`,
    );
    if (!ok) {
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    importMutation.mutate({ file, force: importForce });
  };

  const inputClass =
    "h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-sm text-slate-800";

  return (
    <ConfigSection>
      <ConfigSectionHeader
        title="CotasGraf — semestre"
        description="Controle manual do semestre de cotas por cliente (consumo OS/SP)."
        icon={<Coins className="size-4" aria-hidden />}
      />

      <ConfigSectionBody>
      {query.isPending ? (
        <ConfigLoadingState>
          <Loader2 className="size-4 animate-spin" />
          Carregando semestre…
        </ConfigLoadingState>
      ) : !semestre ? (
        <p className="text-sm text-slate-500">Nenhum semestre aberto encontrado.</p>
      ) : (
        <div className="space-y-4">
          <ConfigSubsection title="Semestre aberto" tone="muted">
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium text-slate-500">Período</dt>
                <dd className="font-semibold text-slate-800">
                  {formatSemestreLabel(semestre.ano, semestre.numero_semestre)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-slate-500">Status</dt>
                <dd className="text-slate-800">{semestre.status}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-slate-500">Vigência</dt>
                <dd className="text-slate-800">
                  {semestre.data_inicio ?? "—"} a {semestre.data_fim ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-slate-500">Limites Deputado (OS / SP)</dt>
                <dd className="text-slate-800">
                  {semestre.limite_os_deputado.toLocaleString("pt-BR")} /{" "}
                  {semestre.limite_sp_deputado.toLocaleString("pt-BR")}
                </dd>
              </div>
            </dl>
          </ConfigSubsection>

          <ConfigSubsection title="Novo semestre">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1 block text-xs font-medium text-slate-600">Ano</span>
                <input
                  type="number"
                  min={2000}
                  max={2100}
                  className={inputClass}
                  value={form.ano}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, ano: Number(e.target.value) || prev.ano }))
                  }
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-xs font-medium text-slate-600">Semestre</span>
                <select
                  className={inputClass}
                  value={form.numero_semestre}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      numero_semestre: Number(e.target.value) as 1 | 2,
                    }))
                  }
                >
                  <option value={1}>1º semestre</option>
                  <option value={2}>2º semestre</option>
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-xs font-medium text-slate-600">Data início</span>
                <input
                  type="date"
                  className={inputClass}
                  value={form.data_inicio}
                  onChange={(e) => setForm((prev) => ({ ...prev, data_inicio: e.target.value }))}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-xs font-medium text-slate-600">Data fim</span>
                <input
                  type="date"
                  className={inputClass}
                  value={form.data_fim}
                  onChange={(e) => setForm((prev) => ({ ...prev, data_fim: e.target.value }))}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-xs font-medium text-slate-600">
                  Limite OS Deputado
                </span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  className={inputClass}
                  value={form.limite_os_deputado}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      limite_os_deputado: Number(e.target.value) || 0,
                    }))
                  }
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-xs font-medium text-slate-600">
                  Limite SP Deputado
                </span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  className={inputClass}
                  value={form.limite_sp_deputado}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      limite_sp_deputado: Number(e.target.value) || 0,
                    }))
                  }
                />
              </label>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                disabled={iniciarMutation.isPending}
                onClick={handleIniciar}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary-green px-3 text-xs font-semibold text-white hover:bg-primary-green/90 disabled:opacity-60"
              >
                {iniciarMutation.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Play className="size-3.5" />
                )}
                Iniciar novo semestre
              </button>
            </div>
          </ConfigSubsection>

          <ConfigSubsection
            title="Tabela de cotas (cache)"
            description='A lista Cotas dos solicitantes lê a tabela pré-calculada tabCotaCliente. Use recalcular após alterações em massa ou na primeira carga do semestre.'
          >
            <button
              type="button"
              disabled={recalcularMutation.isPending}
              onClick={() => {
                const ok = window.confirm(
                  "Recalcular cotas do semestre aberto?\n\n" +
                    "Sincroniza consumos das OS/SP (tabProtocolos) e repopula tabCotaCliente. " +
                    "Importações da Gráfica Rápida são preservadas.",
                );
                if (!ok) return;
                recalcularMutation.mutate();
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-secondary-blue px-3 text-xs font-semibold text-white hover:bg-secondary-blue/90 disabled:opacity-60"
            >
              {recalcularMutation.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              Recalcular cotas
            </button>
          </ConfigSubsection>

          <ConfigSubsection
            title="Importar consumo — Gráfica Rápida"
            description="Planilha exportConsumoGeral (.xls): debita cota OS dos deputados solicitantes. Reimportar o mesmo arquivo é ignorado; PAs já cadastrados não duplicam."
          >
            <label className="mb-3 flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 rounded border-slate-300"
                checked={importForce}
                onChange={(e) => setImportForce(e.target.checked)}
              />
              <span className="text-xs text-slate-600">
                Forçar reimportação do mesmo arquivo (processa novamente, mantendo deduplicação por PA)
              </span>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={(e) => handleImportFile(e.target.files?.[0])}
              />
              <button
                type="button"
                disabled={importMutation.isPending}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                {importMutation.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Upload className="size-3.5" />
                )}
                Selecionar planilha XLS
              </button>
              {lastImportSummary ? (
                <span className="text-xs text-slate-600">{lastImportSummary}</span>
              ) : null}
            </div>
          </ConfigSubsection>
        </div>
      )}
      </ConfigSectionBody>
    </ConfigSection>
  );
}
