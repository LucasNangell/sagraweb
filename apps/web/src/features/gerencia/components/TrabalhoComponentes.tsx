import { Plus, Trash2 } from "lucide-react";

import type { AcabamentoCatalogItem } from "@/api/auxLookups";
import {
  COMPONENTE_LABELS,
  COMPONENTE_TIPOS,
  type ComponenteTipo,
  IMPRESSAO_OPTIONS,
  calculateRemainingPages,
  createComponente,
  createDefaultLote,
  createGenericoComponente,
  createNamedComponente,
  getComponenteKey,
  getComponenteLabel,
  impressaoAfterCoresChange,
  impressaoAfterFvChange,
  isGenericoComponente,
  loteCoresValue,
  loteIsVersoZero,
  lotePapelValue,
  parseImpressao,
  type TechSpec,
  type TechSpecChangeMeta,
  type TechSpecComponente,
  type TechSpecLote,
} from "../techSpec";
import { AcabamentoField } from "./AcabamentoField";
import { Field, Row, gerenciaInputClass } from "./gerenciaFormUi";

function SelectOptions({
  items,
  extra,
  placeholder = "Selecione...",
}: {
  items: string[];
  extra?: string;
  placeholder?: string;
}) {
  const extraValue = (extra || "").trim();
  const all =
    extraValue && !items.includes(extraValue) ? [...items, extraValue] : items;
  return (
    <>
      <option value="">{placeholder}</option>
      {all.map((item) => (
        <option key={item} value={item}>
          {item}
        </option>
      ))}
    </>
  );
}

interface TrabalhoComponentesProps {
  spec: TechSpec;
  /** Total de páginas da OS (campo Detalhes Técnicos) — usado para sugerir miolo/encarte. */
  totalPaginas?: string;
  onChange: (spec: TechSpec, meta?: TechSpecChangeMeta) => void;
  readOnly: boolean;
  maquinas: string[];
  papeis: string[];
  cores: string[];
  acabamentos: AcabamentoCatalogItem[];
}

function parseTotalPaginas(raw: string | undefined): number {
  return Math.max(0, parseInt(String(raw ?? "").trim(), 10) || 0);
}

export function TrabalhoComponentes({
  spec,
  totalPaginas,
  onChange,
  readOnly,
  maquinas,
  papeis,
  cores,
  acabamentos,
}: TrabalhoComponentesProps) {
  const usedTipos = new Set(
    spec.componentes.map((c) => c.tipo).filter(Boolean) as ComponenteTipo[],
  );
  const availableTipos = COMPONENTE_TIPOS.filter((t) => !usedTipos.has(t));

  const updateSpec = (next: TechSpec, meta?: TechSpecChangeMeta) =>
    onChange(next, meta);

  const paginasSugeridasParaNovo = (tipo: ComponenteTipo): number | undefined => {
    if (tipo === "CAPA") return undefined;
    const total = parseTotalPaginas(totalPaginas);
    if (total <= 0) return undefined;
    const restante = calculateRemainingPages(total, spec);
    return restante > 0 ? restante : undefined;
  };

  const addComponente = (tipo: ComponenteTipo) => {
    updateSpec({
      ...spec,
      componentes: [
        ...spec.componentes,
        createComponente(tipo, { paginasInicial: paginasSugeridasParaNovo(tipo) }),
      ],
    });
  };

  const addNamedComponente = () => {
    const nome = window.prompt("Nome do componente:");
    if (!nome?.trim()) return;
    if (isGenericoComponente({ nome, lotes: [] })) {
      window.alert(
        "Arquivo é um componente automático e não pode ser adicionado manualmente.",
      );
      return;
    }
    const total = parseTotalPaginas(totalPaginas);
    const restante =
      total > 0 ? calculateRemainingPages(total, spec) : undefined;
    updateSpec({
      ...spec,
      componentes: [
        ...spec.componentes,
        createNamedComponente(nome, {
          paginasInicial: restante && restante > 0 ? restante : undefined,
        }),
      ],
    });
  };

  const findByKey = (key: string) =>
    spec.componentes.find((c) => getComponenteKey(c) === key);

  const removeComponente = (key: string) => {
    const remaining = spec.componentes.filter((c) => getComponenteKey(c) !== key);
    updateSpec({
      ...spec,
      componentes:
        remaining.length > 0 ? remaining : [createGenericoComponente()],
    });
  };

  const updateComponente = (key: string, comp: TechSpecComponente) => {
    updateSpec({
      ...spec,
      componentes: spec.componentes.map((c) =>
        getComponenteKey(c) === key ? comp : c,
      ),
    });
  };

  const addLote = (key: string) => {
    const comp = findByKey(key);
    if (!comp) return;
    updateComponente(key, {
      ...comp,
      lotes: [...comp.lotes, createDefaultLote()],
    });
  };

  const removeLote = (key: string, loteId: string) => {
    const comp = findByKey(key);
    if (!comp || comp.lotes.length <= 1) return;
    updateComponente(key, {
      ...comp,
      lotes: comp.lotes.filter((l) => l.id !== loteId),
    });
  };

  const updateLote = (
    key: string,
    loteId: string,
    patch: Partial<TechSpecLote>,
  ) => {
    const comp = findByKey(key);
    if (!comp) return;
    const nextSpec: TechSpec = {
      ...spec,
      componentes: spec.componentes.map((c) =>
        getComponenteKey(c) === key
          ? {
              ...c,
              lotes: c.lotes.map((l) =>
                l.id === loteId ? { ...l, ...patch } : l,
              ),
            }
          : c,
      ),
    };
    updateSpec(nextSpec, "paginas" in patch ? { syncValPgs: true } : undefined);
  };

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-slate-600">
          Componentes do trabalho
        </p>
        {!readOnly ? (
          <div className="flex flex-wrap gap-1.5">
            {availableTipos.map((tipo) => (
              <button
                key={tipo}
                type="button"
                onClick={() => addComponente(tipo)}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-secondary-blue shadow-sm transition hover:border-secondary-blue/40 hover:bg-slate-50"
              >
                <Plus className="size-3.5" aria-hidden />
                {COMPONENTE_LABELS[tipo]}
              </button>
            ))}
            <button
              type="button"
              onClick={addNamedComponente}
              className="inline-flex items-center gap-1 rounded-md border border-dashed border-secondary-blue/40 bg-white px-2 py-1 text-xs font-semibold text-secondary-blue shadow-sm transition hover:bg-slate-50"
            >
              <Plus className="size-3.5" aria-hidden />
              Outro componente
            </button>
          </div>
        ) : null}
      </div>

      <div className="space-y-3">
        {spec.componentes.map((comp) => {
          const key = getComponenteKey(comp);
          return (
            <ComponenteCard
              key={key}
              spec={spec}
              comp={comp}
              readOnly={readOnly}
              maquinas={maquinas}
              papeis={papeis}
              cores={cores}
              acabamentos={acabamentos}
              onRename={(nome) => updateComponente(key, { ...comp, nome })}
              onRemove={() => removeComponente(key)}
              onAddLote={() => addLote(key)}
              onRemoveLote={(loteId) => removeLote(key, loteId)}
              onUpdateLote={(loteId, patch) => updateLote(key, loteId, patch)}
            />
          );
        })}
      </div>
    </div>
  );
}

function ComponenteCard({
  spec,
  comp,
  readOnly,
  maquinas,
  papeis,
  cores,
  acabamentos,
  onRename,
  onRemove,
  onAddLote,
  onRemoveLote,
  onUpdateLote,
}: {
  spec: TechSpec;
  comp: TechSpecComponente;
  readOnly: boolean;
  maquinas: string[];
  papeis: string[];
  cores: string[];
  acabamentos: AcabamentoCatalogItem[];
  onRename: (nome: string) => void;
  onRemove: () => void;
  onAddLote: () => void;
  onRemoveLote: (loteId: string) => void;
  onUpdateLote: (loteId: string, patch: Partial<TechSpecLote>) => void;
}) {
  const capaVersoZero = comp.lotes.some((l) => loteIsVersoZero(l, comp));
  const subtitle =
    comp.tipo === "CAPA"
      ? capaVersoZero
        ? "Capa em 4 páginas; verso 0 não entra na cota"
        : "Capa fixa em 4 páginas (ajuste se necessário)"
      : "Variações de páginas, papel, cores e máquina (ex.: policromia + P/B)";

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50/90 p-2.5">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {readOnly ? (
            <p className="text-xs font-extrabold uppercase text-secondary-blue">
              {getComponenteLabel(comp)}
            </p>
          ) : (
            <input
              type="text"
              value={comp.nome}
              onChange={(e) => onRename(e.target.value)}
              className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs font-extrabold uppercase text-secondary-blue"
              aria-label="Nome do componente"
            />
          )}
          <p className="text-[0.65rem] text-slate-500">{subtitle}</p>
        </div>
        {!readOnly ? (
          <button
            type="button"
            title="Remover componente"
            onClick={onRemove}
            className="rounded p-1 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>

      <div className="space-y-2">
        {comp.lotes.map((lote, idx) => (
          <LoteCard
            key={lote.id}
            index={idx}
            lote={lote}
            readOnly={readOnly}
            maquinas={maquinas}
            papeis={papeis}
            cores={cores}
            canRemove={comp.lotes.length > 1}
            onRemove={() => onRemoveLote(lote.id)}
            onChange={(patch) => onUpdateLote(lote.id, patch)}
            acabamentosCatalog={acabamentos}
            techSpec={spec}
          />
        ))}
      </div>

      {!readOnly ? (
        <button
          type="button"
          onClick={onAddLote}
          className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-secondary-blue hover:underline"
        >
          <Plus className="size-3.5" aria-hidden />
          Adicionar variação
        </button>
      ) : null}
    </div>
  );
}

function LoteCard({
  index,
  lote,
  readOnly,
  maquinas,
  papeis,
  cores,
  canRemove,
  onRemove,
  onChange,
  acabamentosCatalog,
  techSpec,
}: {
  index: number;
  lote: TechSpecLote;
  readOnly: boolean;
  maquinas: string[];
  papeis: string[];
  cores: string[];
  canRemove: boolean;
  onRemove: () => void;
  onChange: (patch: Partial<TechSpecLote>) => void;
  acabamentosCatalog: AcabamentoCatalogItem[];
  techSpec: TechSpec;
}) {
  const papelValue = lotePapelValue(lote);
  const coresValue = loteCoresValue(lote);

  const setCatalogOrDesc = (
    kind: "papel" | "cores",
    value: string,
    catalog: string[],
  ) => {
    if (kind === "papel") {
      if (!value) onChange({ papel_link: "", papel_desc: "" });
      else if (catalog.includes(value)) onChange({ papel_link: value, papel_desc: "" });
      else onChange({ papel_link: "", papel_desc: value });
      return;
    }
    const coresPatch = !value
      ? { cores_link: "", cores_desc: "" }
      : catalog.includes(value)
        ? { cores_link: value, cores_desc: "" }
        : { cores_link: "", cores_desc: value };
    const impressao = impressaoAfterCoresChange(lote, value);
    const parsed = parseImpressao(impressao);
    onChange({
      ...coresPatch,
      impressao,
      frente_verso: parsed ? parsed.verso > 0 : lote.frente_verso,
    });
  };

  const setFrenteVerso = (checked: boolean) => {
    onChange({
      frente_verso: checked,
      impressao: impressaoAfterFvChange(lote, checked),
    });
  };

  const setImpressao = (value: string) => {
    const parsed = parseImpressao(value);
    onChange({
      impressao: value,
      frente_verso: parsed ? parsed.verso > 0 : false,
    });
  };

  return (
    <div className="rounded border border-slate-200/80 bg-white p-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-slate-700">Variação {index + 1}</span>
        {!readOnly && canRemove ? (
          <button
            type="button"
            title="Remover variação"
            onClick={onRemove}
            className="rounded p-0.5 text-slate-400 hover:text-red-600"
          >
            <Trash2 className="size-3.5" aria-hidden />
          </button>
        ) : null}
      </div>

      <Row className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-12">
        <Field label="Páginas" className="lg:col-span-2">
          <input
            type="number"
            min={0}
            readOnly={readOnly}
            value={lote.paginas || ""}
            onChange={(e) =>
              onChange({ paginas: Math.max(0, parseInt(e.target.value, 10) || 0) })
            }
            className={gerenciaInputClass}
          />
        </Field>
        <Field label="Papel" className="lg:col-span-2">
          <select
            disabled={readOnly}
            value={papelValue}
            onChange={(e) => setCatalogOrDesc("papel", e.target.value, papeis)}
            className={gerenciaInputClass}
          >
            <SelectOptions items={papeis} extra={papelValue} />
          </select>
        </Field>
        <Field label="Cores" className="lg:col-span-2">
          <select
            disabled={readOnly}
            value={coresValue}
            onChange={(e) => setCatalogOrDesc("cores", e.target.value, cores)}
            className={gerenciaInputClass}
          >
            <SelectOptions items={cores} extra={coresValue} />
          </select>
        </Field>
        <Field label="Impressão" className="lg:col-span-1">
          <select
            disabled={readOnly}
            value={lote.impressao || ""}
            onChange={(e) => setImpressao(e.target.value)}
            className={gerenciaInputClass}
          >
            <SelectOptions items={IMPRESSAO_OPTIONS} extra={lote.impressao} />
          </select>
        </Field>
        <Field label="Máquina" className="lg:col-span-2">
          <select
            disabled={readOnly}
            value={lote.maquina_link}
            onChange={(e) => onChange({ maquina_link: e.target.value })}
            className={gerenciaInputClass}
          >
            <SelectOptions items={maquinas} extra={lote.maquina_link} />
          </select>
        </Field>
        <AcabamentoField
          className="sm:col-span-2 lg:col-span-2"
          label="Acabamento específico"
          catalog={acabamentosCatalog}
          selected={lote.acabamentos ?? []}
          readOnly={readOnly}
          onChange={(next) => onChange({ acabamentos: next })}
          techSpec={techSpec}
        />
        <label className="flex min-w-0 items-end gap-2 pb-1.5 lg:col-span-1">
          <input
            type="checkbox"
            disabled={readOnly}
            checked={Boolean(lote.frente_verso)}
            onChange={(e) => setFrenteVerso(e.target.checked)}
            className="size-4 rounded border-slate-300"
          />
          <span className="text-xs font-semibold text-slate-600">F/V</span>
        </label>
      </Row>
    </div>
  );
}
