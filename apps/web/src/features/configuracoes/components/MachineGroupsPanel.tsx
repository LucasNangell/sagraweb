import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@sagra/ui";
import { Loader2, Plus, Save, Settings2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  createMachineGroup,
  fetchMachineCatalogConfig,
  updateMachineConfig,
} from "@/api/adminSystem";
import type {
  MachineAdminItem,
  MachineConfigRecord,
  MachineGroupRecord,
  MachineGroupType,
  MachinePrintTechnology,
} from "@/features/configuracoes/types";

import {
  ConfigErrorState,
  ConfigLoadingState,
  ConfigSubsection,
} from "./ConfigSectionLayout";

const machineConfigQueryKey = ["admin", "system-catalog", "maquinas-config"] as const;

type MachineConfigDraft = Record<keyof MachineConfigRecord, string>;

const EMPTY_CONFIG: MachineConfigRecord = {
  grupo_id: null,
  tecnologia: null,
  papel_max_altura_mm: null,
  papel_max_largura_mm: null,
  papel_padrao_altura_mm: null,
  papel_padrao_largura_mm: null,
  margem_superior_mm: null,
  margem_direita_mm: null,
  margem_inferior_mm: null,
  margem_esquerda_mm: null,
};

function configToDraft(config: MachineConfigRecord): MachineConfigDraft {
  const source = { ...EMPTY_CONFIG, ...config };
  return {
    grupo_id: source.grupo_id == null ? "" : String(source.grupo_id),
    tecnologia: source.tecnologia ?? "",
    papel_max_altura_mm:
      source.papel_max_altura_mm == null ? "" : String(source.papel_max_altura_mm),
    papel_max_largura_mm:
      source.papel_max_largura_mm == null ? "" : String(source.papel_max_largura_mm),
    papel_padrao_altura_mm:
      source.papel_padrao_altura_mm == null ? "" : String(source.papel_padrao_altura_mm),
    papel_padrao_largura_mm:
      source.papel_padrao_largura_mm == null ? "" : String(source.papel_padrao_largura_mm),
    margem_superior_mm:
      source.margem_superior_mm == null ? "" : String(source.margem_superior_mm),
    margem_direita_mm:
      source.margem_direita_mm == null ? "" : String(source.margem_direita_mm),
    margem_inferior_mm:
      source.margem_inferior_mm == null ? "" : String(source.margem_inferior_mm),
    margem_esquerda_mm:
      source.margem_esquerda_mm == null ? "" : String(source.margem_esquerda_mm),
  };
}

function parseOptionalNumber(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function draftToConfig(draft: MachineConfigDraft): MachineConfigRecord {
  return {
    grupo_id: draft.grupo_id ? Number(draft.grupo_id) : null,
    tecnologia: draft.tecnologia
      ? (draft.tecnologia as MachinePrintTechnology)
      : null,
    papel_max_altura_mm: parseOptionalNumber(draft.papel_max_altura_mm),
    papel_max_largura_mm: parseOptionalNumber(draft.papel_max_largura_mm),
    papel_padrao_altura_mm: parseOptionalNumber(draft.papel_padrao_altura_mm),
    papel_padrao_largura_mm: parseOptionalNumber(draft.papel_padrao_largura_mm),
    margem_superior_mm: parseOptionalNumber(draft.margem_superior_mm),
    margem_direita_mm: parseOptionalNumber(draft.margem_direita_mm),
    margem_inferior_mm: parseOptionalNumber(draft.margem_inferior_mm),
    margem_esquerda_mm: parseOptionalNumber(draft.margem_esquerda_mm),
  };
}

function reportError(error: unknown) {
  window.alert(error instanceof Error ? error.message : "Operação falhou.");
}

export function MachineGroupsPanel() {
  const qc = useQueryClient();
  const [groupName, setGroupName] = useState("");
  const [groupType, setGroupType] = useState<MachineGroupType>("impressora");

  const query = useQuery({
    queryKey: machineConfigQueryKey,
    queryFn: fetchMachineCatalogConfig,
  });

  const groups = query.data?.groups ?? [];
  const machines = query.data?.machines ?? [];

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: machineConfigQueryKey });
    void qc.invalidateQueries({ queryKey: ["admin", "system-catalog", "maquina"] });
    void qc.invalidateQueries({ queryKey: ["aux"] });
  };

  const createGroupMutation = useMutation({
    mutationFn: () =>
      createMachineGroup({ nome: groupName.trim(), tipo: groupType }),
    onSuccess: () => {
      setGroupName("");
      invalidate();
    },
    onError: reportError,
  });

  const groupedCount = useMemo(
    () => machines.filter((machine) => machine.config.grupo_id != null).length,
    [machines],
  );

  return (
    <ConfigSubsection>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
            <Settings2 className="size-4 text-secondary-blue" aria-hidden />
            Grupos e configurações de máquinas
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-600">
            Organize máquinas em grupos e informe os parâmetros opcionais usados por
            impressoras na produção.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          <span className="rounded-full bg-slate-50 px-2 py-1 ring-1 ring-slate-200">
            {groups.length} grupos
          </span>
          <span className="rounded-full bg-slate-50 px-2 py-1 ring-1 ring-slate-200">
            {groupedCount} agrupadas
          </span>
        </div>
      </div>

      <form
        className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_160px_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          if (!groupName.trim()) return;
          void createGroupMutation.mutate();
        }}
      >
        <input
          type="text"
          value={groupName}
          onChange={(event) => setGroupName(event.target.value)}
          placeholder="Novo grupo de máquinas..."
          maxLength={120}
          className="h-9 min-w-0 rounded-lg border border-slate-300 px-3 text-xs outline-none ring-secondary-blue/30 focus:ring-2"
        />
        <select
          value={groupType}
          onChange={(event) => setGroupType(event.target.value as MachineGroupType)}
          className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs outline-none ring-secondary-blue/30 focus:ring-2"
        >
          <option value="impressora">Impressoras</option>
          <option value="geral">Geral</option>
        </select>
        <button
          type="submit"
          disabled={createGroupMutation.isPending || !groupName.trim()}
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary-green px-4 text-xs font-semibold text-white hover:bg-primary-green/90 disabled:opacity-60"
        >
          {createGroupMutation.isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Plus className="size-3.5" />
          )}
          Criar grupo
        </button>
      </form>

      {query.isPending ? (
        <div className="mt-4">
          <ConfigLoadingState>
            <Loader2 className="size-4 animate-spin" />
            Carregando configurações...
          </ConfigLoadingState>
        </div>
      ) : null}

      {query.isError ? (
        <div className="mt-4">
          <ConfigErrorState>
            {query.error instanceof Error
              ? query.error.message
              : "Erro ao carregar configurações de máquinas."}
          </ConfigErrorState>
        </div>
      ) : null}

      {!query.isPending && !query.isError ? (
        <div className="mt-4 divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
          {machines.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs text-slate-500">
              Nenhuma máquina cadastrada.
            </p>
          ) : (
            machines.map((machine) => (
              <MachineConfigRow
                key={`${machine.id ?? "usage"}-${machine.label}`}
                machine={machine}
                groups={groups}
                onSaved={invalidate}
              />
            ))
          )}
        </div>
      ) : null}
    </ConfigSubsection>
  );
}

function MachineConfigRow({
  machine,
  groups,
  onSaved,
}: {
  machine: MachineAdminItem;
  groups: MachineGroupRecord[];
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<MachineConfigDraft>(() =>
    configToDraft(machine.config),
  );

  useEffect(() => {
    setDraft(configToDraft(machine.config));
  }, [machine.config]);

  const selectedGroup = groups.find(
    (group) => String(group.id) === draft.grupo_id,
  );
  const showsPrinterFields =
    selectedGroup?.tipo === "impressora" ||
    Boolean(draft.tecnologia) ||
    Boolean(draft.papel_max_altura_mm || draft.papel_max_largura_mm);

  const saveMutation = useMutation({
    mutationFn: () => updateMachineConfig(machine.label, draftToConfig(draft)),
    onSuccess: onSaved,
    onError: reportError,
  });

  const updateDraft = (key: keyof MachineConfigRecord, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  return (
    <div className={cn("bg-white px-3 py-3", !machine.active && "bg-slate-50")}>
      <div className="grid gap-3 lg:grid-cols-[minmax(180px,0.9fr)_minmax(0,2.1fr)_auto] lg:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "truncate text-sm font-semibold",
                machine.active ? "text-slate-800" : "text-slate-500 line-through",
              )}
            >
              {machine.label}
            </span>
            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
              {machine.source === "catalog" ? "Cadastrada" : "Em uso"}
            </span>
          </div>
          <select
            value={draft.grupo_id}
            onChange={(event) => updateDraft("grupo_id", event.target.value)}
            className="mt-2 h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-xs outline-none ring-secondary-blue/30 focus:ring-2"
          >
            <option value="">Sem grupo</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.nome}
              </option>
            ))}
          </select>
        </div>

        <div className="min-w-0">
          {showsPrinterFields ? (
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              <FieldSelect
                label="Tecnologia"
                value={draft.tecnologia}
                onChange={(value) => updateDraft("tecnologia", value)}
              />
              <FieldPair
                label="Papel máximo"
                first={draft.papel_max_altura_mm}
                second={draft.papel_max_largura_mm}
                firstPlaceholder="Altura"
                secondPlaceholder="Largura"
                onFirst={(value) => updateDraft("papel_max_altura_mm", value)}
                onSecond={(value) => updateDraft("papel_max_largura_mm", value)}
              />
              <FieldPair
                label="Papel padrão"
                first={draft.papel_padrao_altura_mm}
                second={draft.papel_padrao_largura_mm}
                firstPlaceholder="Altura"
                secondPlaceholder="Largura"
                onFirst={(value) => updateDraft("papel_padrao_altura_mm", value)}
                onSecond={(value) => updateDraft("papel_padrao_largura_mm", value)}
              />
              <MarginsFields draft={draft} onChange={updateDraft} />
            </div>
          ) : (
            <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500 ring-1 ring-slate-200">
              Selecione um grupo do tipo impressoras para informar tecnologia,
              papel e área de impressão.
            </p>
          )}
        </div>

        <button
          type="button"
          disabled={saveMutation.isPending}
          onClick={() => void saveMutation.mutate()}
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-secondary-blue/30 bg-white px-3 text-xs font-semibold text-secondary-blue hover:bg-secondary-blue/5 disabled:opacity-60"
        >
          {saveMutation.isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Save className="size-3.5" />
          )}
          Salvar
        </button>
      </div>
    </div>
  );
}

function FieldSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-xs outline-none ring-secondary-blue/30 focus:ring-2"
      >
        <option value="">Opcional</option>
        <option value="digital">Digital</option>
        <option value="offset">Offset</option>
      </select>
    </label>
  );
}

function FieldPair({
  label,
  first,
  second,
  firstPlaceholder,
  secondPlaceholder,
  onFirst,
  onSecond,
}: {
  label: string;
  first: string;
  second: string;
  firstPlaceholder: string;
  secondPlaceholder: string;
  onFirst: (value: string) => void;
  onSecond: (value: string) => void;
}) {
  return (
    <div className="min-w-0">
      <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">
        {label} (mm)
      </span>
      <div className="grid grid-cols-2 gap-1.5">
        <input
          type="number"
          min="0"
          step="0.01"
          value={first}
          onChange={(event) => onFirst(event.target.value)}
          placeholder={firstPlaceholder}
          className="h-8 min-w-0 rounded-md border border-slate-300 px-2 text-xs outline-none ring-secondary-blue/30 focus:ring-2"
        />
        <input
          type="number"
          min="0"
          step="0.01"
          value={second}
          onChange={(event) => onSecond(event.target.value)}
          placeholder={secondPlaceholder}
          className="h-8 min-w-0 rounded-md border border-slate-300 px-2 text-xs outline-none ring-secondary-blue/30 focus:ring-2"
        />
      </div>
    </div>
  );
}

function MarginsFields({
  draft,
  onChange,
}: {
  draft: MachineConfigDraft;
  onChange: (key: keyof MachineConfigRecord, value: string) => void;
}) {
  const fields: Array<[keyof MachineConfigRecord, string]> = [
    ["margem_superior_mm", "Sup."],
    ["margem_direita_mm", "Dir."],
    ["margem_inferior_mm", "Inf."],
    ["margem_esquerda_mm", "Esq."],
  ];

  return (
    <div className="min-w-0">
      <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">
        Remover por lado (mm)
      </span>
      <div className="grid grid-cols-4 gap-1.5">
        {fields.map(([key, placeholder]) => (
          <input
            key={key}
            type="number"
            min="0"
            step="0.01"
            value={draft[key]}
            onChange={(event) => onChange(key, event.target.value)}
            placeholder={placeholder}
            className="h-8 min-w-0 rounded-md border border-slate-300 px-1.5 text-xs outline-none ring-secondary-blue/30 focus:ring-2"
          />
        ))}
      </div>
    </div>
  );
}
