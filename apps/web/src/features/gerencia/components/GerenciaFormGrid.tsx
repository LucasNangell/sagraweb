import { cn } from "@sagra/ui";
import { Calculator, User } from "lucide-react";

import { PRIORIDADE_GERENCIA } from "../constants";
import type { GerenciaFormState, GerenciaFormUpdater } from "../types";
import type { FormatoLookupItem } from "../formatoDimensions";
import type { TechSpec, TechSpecChangeMeta } from "../techSpec";
import {
  applyUsarTodaCota,
  computeTiragemMaximaFromForm,
  patchFormatoDimensions,
  patchTiragemMaximaFromCota,
  recalculateGerenciaCalcs,
} from "../utils";
import {
  Field,
  GerenciaPanel,
  Row,
  gerenciaInputClass,
  gerenciaInputCompactClass,
} from "./gerenciaFormUi";
import { CalculosCustosPanel } from "./CalculosCustosPanel";
import { FormatoCombobox } from "./FormatoCombobox";
import { TrabalhoComponentes } from "./TrabalhoComponentes";

interface GerenciaFormGridProps {
  form: GerenciaFormState;
  update: GerenciaFormUpdater;
  readOnly: boolean;
  categorias: string[];
  produtos: string[];
  maquinas: string[];
  papeis: string[];
  cores: string[];
  formatos: FormatoLookupItem[];
  techSpec: TechSpec;
  onTechSpecChange: (spec: TechSpec, meta?: TechSpecChangeMeta) => void;
  deputyPhoto?: string | null;
  onSolicitanteBlur?: () => void;
}

function set<K extends keyof GerenciaFormState>(
  update: GerenciaFormUpdater,
  key: K,
  value: GerenciaFormState[K],
) {
  update({ [key]: value } as Partial<GerenciaFormState>);
}

function setFormato(
  update: GerenciaFormUpdater,
  formato: string,
  formatosLookup: FormatoLookupItem[],
) {
  update((prev) => {
    const merged = { ...prev, ...patchFormatoDimensions(prev, formato, formatosLookup) };
    const withCalcs = { ...merged, ...recalculateGerenciaCalcs(merged) };
    return { ...withCalcs, ...patchTiragemMaximaFromCota(withCalcs) };
  });
}

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

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return `${parts[0].charAt(0)}${parts[parts.length - 1].charAt(0)}`.toUpperCase();
}

export function GerenciaFormGrid({
  form,
  update,
  readOnly,
  categorias,
  produtos,
  maquinas,
  papeis,
  cores,
  formatos,
  techSpec,
  onTechSpecChange,
  deputyPhoto,
  onSolicitanteBlur,
}: GerenciaFormGridProps) {
  const ro = readOnly;

  return (
    <div className="gerencia-grid pb-28">
      <div className="grid gap-3.5 min-[1900px]:grid-cols-[7fr_5fr] min-[1900px]:grid-rows-[auto_auto] min-[1900px]:items-start">
        {/* Linha 1 esquerda: Solicitante + Ordem */}
        <div className="grid gap-3.5 lg:grid-cols-[4fr_3fr] min-[1900px]:col-start-1 min-[1900px]:row-start-1">
          <GerenciaPanel title="Informações do Solicitante" bodyClassName="p-2.5">
            <div className="flex items-center gap-2.5">
              <div className="min-w-0 flex-1 space-y-1.5">
                <Row compact className="grid-cols-1 sm:grid-cols-2">
                  <Field label="Categoria" compact>
                    <select
                      disabled={ro}
                      value={form.req_categoria}
                      onChange={(e) =>
                        update((prev) => {
                          const merged = { ...prev, req_categoria: e.target.value };
                          const withCalcs = {
                            ...merged,
                            ...recalculateGerenciaCalcs(merged),
                          };
                          return {
                            ...withCalcs,
                            ...patchTiragemMaximaFromCota(withCalcs),
                          };
                        })
                      }
                      className={gerenciaInputCompactClass}
                    >
                      <SelectOptions items={categorias} />
                    </select>
                  </Field>
                  <Field label="Cód. Req." compact>
                    <input
                      readOnly={ro}
                      value={form.req_codigo}
                      onChange={(e) => set(update, "req_codigo", e.target.value)}
                      className={gerenciaInputCompactClass}
                    />
                  </Field>
                </Row>
                <Field label="Solicitante" compact>
                  <input
                    readOnly={ro}
                    value={form.req_solicitante}
                    onChange={(e) => set(update, "req_solicitante", e.target.value)}
                    onBlur={onSolicitanteBlur}
                    className={gerenciaInputCompactClass}
                  />
                </Field>
                <Field label="Órgão Interessado" compact>
                  <input
                    readOnly={ro}
                    value={form.req_orgao_interessado}
                    onChange={(e) => set(update, "req_orgao_interessado", e.target.value)}
                    className={gerenciaInputCompactClass}
                  />
                </Field>
                <Row compact className="grid-cols-1 sm:grid-cols-[2fr_1fr]">
                  <Field label="Titular" compact>
                    <input
                      readOnly={ro}
                      value={form.req_titular}
                      onChange={(e) => set(update, "req_titular", e.target.value)}
                      className={gerenciaInputCompactClass}
                    />
                  </Field>
                  <Field label="Sigla" compact>
                    <input
                      readOnly={ro}
                      value={form.req_sigla}
                      onChange={(e) => set(update, "req_sigla", e.target.value)}
                      className={gerenciaInputCompactClass}
                    />
                  </Field>
                </Row>
                <Field label="Gabinete" compact>
                  <input
                    readOnly={ro}
                    value={form.req_gabinete}
                    onChange={(e) => set(update, "req_gabinete", e.target.value)}
                    className={gerenciaInputCompactClass}
                  />
                </Field>
                <div className="border-t border-dashed border-slate-200 pt-1.5">
                  <p className="mb-1 text-[0.65rem] font-semibold text-primary-green">
                    Endereço / Contato
                  </p>
                  <Row compact className="grid-cols-1 sm:grid-cols-3">
                    <Field label="Andar" compact>
                      <input
                        readOnly={ro}
                        value={form.req_andar}
                        onChange={(e) => set(update, "req_andar", e.target.value)}
                        className={gerenciaInputCompactClass}
                      />
                    </Field>
                    <Field label="Local" compact>
                      <input
                        readOnly={ro}
                        value={form.req_local}
                        onChange={(e) => set(update, "req_local", e.target.value)}
                        className={gerenciaInputCompactClass}
                      />
                    </Field>
                    <Field label="Ramal" compact>
                      <input
                        readOnly={ro}
                        value={form.req_ramal}
                        onChange={(e) => set(update, "req_ramal", e.target.value)}
                        className={gerenciaInputCompactClass}
                      />
                    </Field>
                  </Row>
                </div>
              </div>
              <div className="flex w-[9rem] shrink-0 flex-col items-center justify-center">
                <div className="flex aspect-[3/4] w-full items-center justify-center overflow-hidden rounded-md border-2 border-slate-200 bg-slate-100 text-lg font-bold text-secondary-blue">
                  {deputyPhoto ? (
                    <img
                      src={deputyPhoto}
                      alt=""
                      className="size-full object-cover object-top"
                    />
                  ) : form.req_solicitante ? (
                    initials(form.req_solicitante)
                  ) : (
                    <User className="size-12 text-slate-400" aria-hidden />
                  )}
                </div>
                <span className="mt-1 text-center text-[0.6rem] font-semibold uppercase tracking-wide text-slate-400">
                  Foto
                </span>
              </div>
            </div>
          </GerenciaPanel>

          <GerenciaPanel title="Ordem de Produção">
            <div className="flex h-full flex-col gap-2.5">
              <Row className="grid-cols-1 sm:grid-cols-2">
                <Field label="OS / Ano">
                  <div className="mt-1 flex items-center gap-1">
                    <input
                      readOnly
                      value={form.op_os}
                      placeholder="0000"
                      className={cn(gerenciaInputClass, "mt-0 text-center")}
                    />
                    <span className="font-bold text-slate-500">/</span>
                    <input
                      readOnly
                      value={form.op_ano}
                      placeholder="AAAA"
                      className={cn(gerenciaInputClass, "mt-0 text-center")}
                    />
                  </div>
                </Field>
                <Field label="Data Entrada">
                  <input
                    type="date"
                    readOnly={ro}
                    value={form.op_data_entrada}
                    onChange={(e) => set(update, "op_data_entrada", e.target.value)}
                    className={gerenciaInputClass}
                  />
                </Field>
              </Row>
              <Field label="Título da Obra">
                <input
                  readOnly={ro}
                  value={form.val_titulo}
                  onChange={(e) => set(update, "val_titulo", e.target.value)}
                  className={gerenciaInputClass}
                />
              </Field>
              <Row className="grid-cols-1 sm:grid-cols-2">
                <Field label="Processo">
                  <input
                    readOnly={ro}
                    value={form.op_processo}
                    onChange={(e) => set(update, "op_processo", e.target.value)}
                    className={gerenciaInputClass}
                  />
                </Field>
                <Field label="Com. Serviço">
                  <input
                    readOnly={ro}
                    value={form.op_cs}
                    onChange={(e) => set(update, "op_cs", e.target.value)}
                    className={gerenciaInputClass}
                  />
                </Field>
              </Row>
              <Row className="grid-cols-1 sm:grid-cols-2">
                <Field label="Prioridade">
                  <select
                    disabled={ro}
                    value={form.val_prioridade}
                    onChange={(e) => set(update, "val_prioridade", e.target.value)}
                    className={gerenciaInputClass}
                  >
                    {PRIORIDADE_GERENCIA.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Data Entrega">
                  <input
                    type="date"
                    readOnly={ro}
                    value={form.val_data}
                    onChange={(e) => set(update, "val_data", e.target.value)}
                    className={gerenciaInputClass}
                  />
                </Field>
              </Row>
              <div className="mt-auto rounded-md bg-slate-50 p-2.5">
                <p className="mb-1.5 text-xs font-extrabold uppercase text-secondary-blue">
                  Tiragem
                </p>
                <Row className="grid-cols-3 gap-1.5">
                  <Field label="Cota atual" className="min-w-0">
                    <input
                      readOnly
                      tabIndex={-1}
                      inputMode="decimal"
                      value={form.op_cota_atual}
                      className={cn(
                        gerenciaInputClass,
                        "min-w-0 bg-slate-50 text-slate-700",
                      )}
                      placeholder="—"
                      title="Saldo de cota do semestre (CotasGraf)"
                    />
                  </Field>
                  <Field label="Tiragem máxima" className="min-w-0">
                    <input
                      readOnly
                      tabIndex={-1}
                      value={
                        form.op_cota_atual.trim()
                          ? computeTiragemMaximaFromForm(form)
                          : form.op_tiragem_pret
                      }
                      className={cn(
                        gerenciaInputClass,
                        "min-w-0 bg-slate-50 text-slate-700",
                      )}
                      title="Calculada a partir da cota atual, páginas e formato"
                    />
                  </Field>
                  <Field label="Tiragem final" className="min-w-0">
                    <input
                      readOnly={ro}
                      value={form.op_tiragem_final}
                      onChange={(e) =>
                        set(update, "op_tiragem_final", e.target.value)
                      }
                      className={cn(gerenciaInputClass, "min-w-0")}
                    />
                    {!ro ? (
                      <button
                        type="button"
                        disabled={!computeTiragemMaximaFromForm(form)}
                        onClick={() => update((prev) => applyUsarTodaCota(prev))}
                        className="mt-1 w-full rounded-md border border-secondary-blue/30 bg-white px-1.5 py-1 text-[0.6rem] font-semibold leading-tight text-secondary-blue shadow-sm transition hover:border-secondary-blue/50 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                        title="Define tiragem final e sincroniza detalhes técnicos e cálculos"
                      >
                        Usar toda cota
                      </button>
                    ) : null}
                  </Field>
                </Row>
              </div>
            </div>
          </GerenciaPanel>
        </div>

        {/* Coluna direita: Detalhes técnicos (altura total) */}
        <GerenciaPanel
          title="Detalhes Técnicos"
          scrollableBody
          className={cn(
            "max-h-[var(--gerencia-detalhes-max-h)] min-h-0",
            "min-[1900px]:col-start-2 min-[1900px]:row-span-2 min-[1900px]:row-start-1",
            "min-[1900px]:sticky min-[1900px]:top-0 min-[1900px]:self-start",
          )}
        >
          <div className="space-y-3">
            <Row className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Produto">
                <select
                  disabled={ro}
                  value={form.val_produto}
                  onChange={(e) => set(update, "val_produto", e.target.value)}
                  className={gerenciaInputClass}
                >
                  <SelectOptions items={produtos} />
                </select>
              </Field>
              <Field label="Máquina">
                <select
                  disabled={ro}
                  value={form.val_maquina}
                  onChange={(e) => set(update, "val_maquina", e.target.value)}
                  className={gerenciaInputClass}
                >
                  <SelectOptions items={maquinas} />
                </select>
              </Field>
              <Field label="Tiragem">
                <input
                  readOnly={ro}
                  value={form.val_tiragem}
                  onChange={(e) => {
                    const v = e.target.value;
                    update((prev) => {
                      const merged = { ...prev, val_tiragem: v, calc_tiragem: v };
                      return { ...merged, ...recalculateGerenciaCalcs(merged) };
                    });
                  }}
                  className={gerenciaInputClass}
                />
              </Field>
              <Field label="Páginas">
                <input
                  readOnly={ro}
                  value={form.val_pgs}
                  onChange={(e) => {
                    const v = e.target.value;
                    update((prev) => {
                      const merged = { ...prev, val_pgs: v };
                      const withCalcs = {
                        ...merged,
                        ...recalculateGerenciaCalcs(merged),
                      };
                      return {
                        ...withCalcs,
                        ...patchTiragemMaximaFromCota(withCalcs),
                      };
                    });
                  }}
                  className={gerenciaInputClass}
                />
              </Field>
              <label className="flex items-end gap-2 pb-1.5 text-xs font-semibold text-slate-600">
                <input
                  type="checkbox"
                  disabled={ro}
                  checked={form.chk_fv}
                  onChange={(e) => set(update, "chk_fv", e.target.checked)}
                  className="size-4 rounded border-slate-300"
                />
                F/V
              </label>
            </Row>
            <Row className="grid-cols-1 md:grid-cols-2">
              <Field label="Modelos">
                <input
                  readOnly={ro}
                  value={form.val_modelos}
                  onChange={(e) => set(update, "val_modelos", e.target.value)}
                  className={gerenciaInputClass}
                />
              </Field>
              <Field label="Formato">
                <FormatoCombobox
                  value={form.val_formato}
                  formatos={formatos}
                  readOnly={ro}
                  onChange={(v) => setFormato(update, v, formatos)}
                />
              </Field>
            </Row>

            <TrabalhoComponentes
              spec={techSpec}
              totalPaginas={form.val_pgs}
              onChange={onTechSpecChange}
              readOnly={ro}
              maquinas={maquinas}
              papeis={papeis}
              cores={cores}
            />

            <Row className="grid-cols-1 md:grid-cols-3">
              <Field label="Papel">
                <select
                  disabled={ro}
                  value={form.val_papel}
                  onChange={(e) => set(update, "val_papel", e.target.value)}
                  className={gerenciaInputClass}
                >
                  <SelectOptions items={papeis} />
                </select>
                <textarea
                  readOnly={ro}
                  rows={2}
                  placeholder="Descrição..."
                  value={form.txt_papel_desc}
                  onChange={(e) => set(update, "txt_papel_desc", e.target.value)}
                  className={cn(gerenciaInputClass, "mt-1.5 resize-y")}
                />
              </Field>
              <Field label="Cores">
                <select
                  disabled={ro}
                  value={form.val_cores}
                  onChange={(e) => set(update, "val_cores", e.target.value)}
                  className={gerenciaInputClass}
                >
                  <SelectOptions items={cores} />
                </select>
                <textarea
                  readOnly={ro}
                  rows={2}
                  placeholder="Descrição..."
                  value={form.txt_cores_desc}
                  onChange={(e) => set(update, "txt_cores_desc", e.target.value)}
                  className={cn(gerenciaInputClass, "mt-1.5 resize-y")}
                />
              </Field>
              <Field label="Acabamento">
                <textarea
                  readOnly={ro}
                  rows={5}
                  value={form.txt_acabamento}
                  onChange={(e) => set(update, "txt_acabamento", e.target.value)}
                  className={cn(gerenciaInputClass, "min-h-[88px] resize-y")}
                />
              </Field>
            </Row>

            <Row className="grid-cols-1 md:grid-cols-2">
              <Field label="Obs">
                <textarea
                  readOnly={ro}
                  rows={4}
                  value={form.txt_obs}
                  onChange={(e) => set(update, "txt_obs", e.target.value)}
                  className={cn(gerenciaInputClass, "min-h-[72px] resize-y")}
                />
              </Field>
              <Field label="Contato">
                <textarea
                  readOnly={ro}
                  rows={4}
                  value={form.txt_contato}
                  onChange={(e) => set(update, "txt_contato", e.target.value)}
                  className={cn(gerenciaInputClass, "min-h-[72px] resize-y")}
                />
              </Field>
            </Row>
          </div>
        </GerenciaPanel>

        {/* Linha 2 esquerda: Material + Elementos + Cálculos */}
        <div className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-3 min-[1900px]:col-start-1 min-[1900px]:row-start-2">
          <GerenciaPanel title="Material Entregue">
            <div className="grid grid-cols-2 gap-2">
              <CheckRow
                id="mat_amostra"
                label="Amostra"
                checked={form.mat_amostra}
                readOnly={ro}
                onChange={(v) => set(update, "mat_amostra", v)}
              />
              <CheckRow
                id="mat_fotolito"
                label="Fotolito"
                checked={form.mat_fotolito}
                readOnly={ro}
                onChange={(v) => set(update, "mat_fotolito", v)}
              />
              <CheckRow
                id="mat_dobra"
                label="Mod. Dobra"
                checked={form.mat_dobra}
                readOnly={ro}
                onChange={(v) => set(update, "mat_dobra", v)}
              />
              <CheckRow
                id="mat_original"
                label="Prova Imp."
                checked={form.mat_original}
                readOnly={ro}
                onChange={(v) => set(update, "mat_original", v)}
              />
            </div>
            <Field label="Insumos Fornecidos" className="mt-2">
              <textarea
                readOnly={ro}
                rows={2}
                placeholder="Descreva os insumos..."
                value={form.mat_insumos}
                onChange={(e) => set(update, "mat_insumos", e.target.value)}
                className={cn(gerenciaInputClass, "resize-y")}
              />
            </Field>
          </GerenciaPanel>

          <GerenciaPanel title="Elementos Gráficos">
            <p className="mb-2 text-xs italic text-slate-400">
              Selecione os elementos institucionais:
            </p>
            <div className="grid grid-cols-2 gap-2">
              <ElementCard
                id="el_brasao"
                icon="🛡️"
                label="Brasão"
                checked={form.el_brasao}
                readOnly={ro}
                onChange={(v) => set(update, "el_brasao", v)}
              />
              <ElementCard
                id="el_timbre"
                icon="📝"
                label="Timbre"
                checked={form.el_timbre}
                readOnly={ro}
                onChange={(v) => set(update, "el_timbre", v)}
              />
              <ElementCard
                id="el_arte"
                icon="🎨"
                label="Arte Gab."
                checked={form.el_arte}
                readOnly={ro}
                onChange={(v) => set(update, "el_arte", v)}
              />
              <ElementCard
                id="el_assinatura"
                icon="✍️"
                label="Assinatura"
                checked={form.el_assinatura}
                readOnly={ro}
                onChange={(v) => set(update, "el_assinatura", v)}
              />
            </div>
          </GerenciaPanel>

          <GerenciaPanel
            title="Cálculos & Custos"
            icon={<Calculator className="size-4 text-secondary-blue" aria-hidden />}
          >
            <CalculosCustosPanel
              form={form}
              update={update}
              techSpec={techSpec}
              readOnly={ro}
            />
          </GerenciaPanel>
        </div>
      </div>
    </div>
  );
}

function CheckRow({
  id,
  label,
  checked,
  readOnly,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  readOnly: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-sm text-slate-700">
      <input
        id={id}
        type="checkbox"
        disabled={readOnly}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 rounded border-slate-300"
      />
      {label}
    </label>
  );
}

function ElementCard({
  id,
  icon,
  label,
  checked,
  readOnly,
  onChange,
}: {
  id: string;
  icon: string;
  label: string;
  checked: boolean;
  readOnly: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex cursor-pointer flex-col items-center gap-1 rounded-lg border p-2 text-center transition",
        checked ? "border-primary-green bg-primary-green/5" : "border-slate-200 bg-white hover:border-slate-300",
        readOnly && "cursor-not-allowed opacity-70",
      )}
    >
      <input
        id={id}
        type="checkbox"
        className="sr-only"
        disabled={readOnly}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="text-lg">{icon}</span>
      <span className="text-xs font-medium">{label}</span>
    </label>
  );
}
