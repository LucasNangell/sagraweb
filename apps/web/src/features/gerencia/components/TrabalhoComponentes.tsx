import { Plus, Trash2 } from "lucide-react";

import {
  COMPONENTE_LABELS,
  COMPONENTE_TIPOS,
  type ComponenteTipo,
  calculateRemainingPages,
  createComponente,
  createDefaultLote,
  createNamedComponente,
  getComponenteKey,
  getComponenteLabel,
  type TechSpec,
  type TechSpecChangeMeta,
  type TechSpecComponente,
  type TechSpecLote,
} from "../techSpec";
import { Field, Row, gerenciaInputClass } from "./gerenciaFormUi";

function SelectOptions({
  items,
  placeholder = "Selecione...",
}: {
  items: string[];
  placeholder?: string;
}) {
  return (
    <>
      <option value="">{placeholder}</option>
      {items.map((item) => (
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
    updateSpec({
      ...spec,
      componentes: spec.componentes.filter((c) => getComponenteKey(c) !== key),
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

      {spec.componentes.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-200 bg-slate-50/80 px-3 py-4 text-center text-xs text-slate-500">
          {readOnly
            ? "Nenhum componente cadastrado."
            : "Adicione Capa, Miolo ou Encarte conforme o trabalho."}
        </p>
      ) : null}

      <div className="space-y-3">
        {spec.componentes.map((comp) => {
          const key = getComponenteKey(comp);
          return (
            <ComponenteCard
              key={key}
              comp={comp}
              readOnly={readOnly}
              maquinas={maquinas}
              papeis={papeis}
              cores={cores}
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
  comp,
  readOnly,
  maquinas,
  papeis,
  cores,
  onRename,
  onRemove,
  onAddLote,
  onRemoveLote,
  onUpdateLote,
}: {
  comp: TechSpecComponente;
  readOnly: boolean;
  maquinas: string[];
  papeis: string[];
  cores: string[];
  onRename: (nome: string) => void;
  onRemove: () => void;
  onAddLote: () => void;
  onRemoveLote: (loteId: string) => void;
  onUpdateLote: (loteId: string, patch: Partial<TechSpecLote>) => void;
}) {
  const subtitle =
    comp.tipo === "CAPA"
      ? "Capa fixa em 4 páginas (ajuste se necessário)"
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
}) {
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

      <Row className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Páginas">
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
        <Field label="Papel">
          <select
            disabled={readOnly}
            value={lote.papel_link}
            onChange={(e) => onChange({ papel_link: e.target.value })}
            className={gerenciaInputClass}
          >
            <SelectOptions items={papeis} />
          </select>
        </Field>
        <Field label="Cores">
          <select
            disabled={readOnly}
            value={lote.cores_link}
            onChange={(e) => onChange({ cores_link: e.target.value })}
            className={gerenciaInputClass}
          >
            <SelectOptions items={cores} />
          </select>
        </Field>
        <Field label="Máquina">
          <select
            disabled={readOnly}
            value={lote.maquina_link}
            onChange={(e) => onChange({ maquina_link: e.target.value })}
            className={gerenciaInputClass}
          >
            <SelectOptions items={maquinas} />
          </select>
        </Field>
      </Row>
    </div>
  );
}
