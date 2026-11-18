import { cn } from "@sagra/ui";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  LayoutGrid,
  Loader2,
  RotateCw,
  UploadCloud,
} from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import { PerfilImposicaoPreview } from "./PerfilImposicaoPreview";
import {
  converterParaManual,
  FOLHA_PRESETS,
  folhaMm,
  formatMm,
  gerarSlotsPelaGrade,
  REGRA_TIRAGEM_INFO,
  resolverSlots,
} from "./perfilUtils";
import { SlotsTable } from "./SlotsTable";
import type {
  Face,
  MarcasArquivo,
  PdfInfo,
  PerfilImposicao,
  PerfilSlot,
  RegraTiragem,
  ValidacaoItem,
} from "./types";

type Props = {
  perfil: PerfilImposicao;
  onChange: (next: PerfilImposicao) => void;
  /** Erros/avisos do servidor (campo → mensagens). */
  erros?: ValidacaoItem[];
  avisos?: ValidacaoItem[];
  marcasInfo?: PdfInfo | null;
  marcasInfoLoading?: boolean;
  onVerificarMarcas?: (path: string) => void;
  /** Envia o PDF de marcas ao servidor. */
  onEnviarMarcas?: (file: File) => void;
  /** Copia para o servidor o PDF de um caminho de rede. */
  onImportarMarcas?: (path: string) => void;
  marcasEnviando?: boolean;
  /** Dados do PDF guardado no servidor (marcas.arquivo). */
  marcasArquivoInfo?: MarcasArquivo | null;
  marcasArquivoUrl?: string | null;
  backgroundUrl?: string | null;
  situacoes?: string[];
  produtos?: string[];
  produtoAtual?: string;
};

const inputCls =
  "w-full rounded border border-slate-300 px-2 py-1.5 text-xs text-slate-800 focus:border-secondary-blue focus:outline-none disabled:bg-slate-50 disabled:text-slate-400";
const labelCls = "flex flex-col gap-1 text-xs text-slate-600";
const hintCls = "text-[10px] text-slate-400";

function toNum(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function NumberInput({
  label,
  value,
  onChange,
  step = 0.1,
  min = 0,
  hint,
  disabled,
}: {
  label: string;
  value: number | null | undefined;
  onChange: (n: number | null) => void;
  step?: number;
  min?: number;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className={labelCls}>
      {label}
      <input
        type="number"
        className={inputCls}
        value={value ?? ""}
        min={min}
        step={step}
        disabled={disabled}
        onChange={(e) => onChange(toNum(e.target.value))}
      />
      {hint ? <span className={hintCls}>{hint}</span> : null}
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  hint,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className={cn("flex flex-col gap-0.5 text-xs text-slate-700", disabled && "opacity-60")}>
      <span className="inline-flex items-center gap-2">
        <input
          type="checkbox"
          className="size-3.5 rounded border-slate-300"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        {label}
      </span>
      {hint ? <span className={cn(hintCls, "pl-5")}>{hint}</span> : null}
    </label>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: Array<{ id: T; label: string }>;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          className={cn(
            "rounded-md px-2.5 py-1 text-[11px] font-semibold",
            value === o.id ? "bg-white text-secondary-blue shadow-sm" : "text-slate-600 hover:text-slate-900",
          )}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Section({
  n,
  title,
  resumo,
  children,
  defaultOpen = true,
  problems = 0,
}: {
  n: number;
  title: string;
  resumo?: string | null;
  children: ReactNode;
  defaultOpen?: boolean;
  problems?: number;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown className="size-3.5 text-slate-400" /> : <ChevronRight className="size-3.5 text-slate-400" />}
        <span className="text-xs font-bold text-slate-800">
          {n}. {title}
        </span>
        {problems > 0 ? (
          <span className="rounded-full bg-red-100 px-1.5 text-[10px] font-semibold text-red-700">{problems}</span>
        ) : null}
        {!open && resumo ? <span className="ml-auto truncate text-[11px] text-slate-500">{resumo}</span> : null}
      </button>
      {open ? <div className="flex flex-col gap-3 border-t border-slate-100 px-3 py-3">{children}</div> : null}
    </section>
  );
}

function FieldMessages({ items, tone }: { items: ValidacaoItem[]; tone: "erro" | "aviso" }) {
  if (!items.length) return null;
  return (
    <ul className={cn("space-y-0.5 text-[11px]", tone === "erro" ? "text-red-600" : "text-amber-700")}>
      {items.map((i, idx) => (
        <li key={`${i.campo}-${idx}`}>{i.mensagem}</li>
      ))}
    </ul>
  );
}

export function PerfilImposicaoEditor({
  perfil,
  onChange,
  erros = [],
  avisos = [],
  marcasInfo,
  marcasInfoLoading,
  onVerificarMarcas,
  onEnviarMarcas,
  onImportarMarcas,
  marcasEnviando,
  marcasArquivoInfo,
  marcasArquivoUrl,
  backgroundUrl,
  situacoes = [],
  produtos = [],
  produtoAtual,
}: Props) {
  const [face, setFace] = useState<Face>("frente");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [pagGrade, setPagGrade] = useState(1);
  const marcasFileRef = useRef<HTMLInputElement | null>(null);
  const marcasTamanhoDiverge = (info: { largura_mm: number | null; altura_mm: number | null } | null | undefined) =>
    Boolean(
      info &&
        perfil.folha.largura_mm &&
        perfil.folha.altura_mm &&
        info.largura_mm &&
        info.altura_mm &&
        (Math.abs(info.largura_mm - perfil.folha.largura_mm) > 0.5 ||
          Math.abs(info.altura_mm - perfil.folha.altura_mm) > 0.5),
    );
  const duplex = perfil.faces === "frente_verso";
  const faceAtual: Face = duplex ? face : "frente";
  const usaVariasPaginas =
    perfil.arte.fonte !== "pre_impresso" &&
    (duplex || perfil.slots.frente.some((s) => s.pagina > 1));

  const set = <K extends keyof PerfilImposicao>(key: K, value: PerfilImposicao[K]) =>
    onChange({ ...perfil, [key]: value });

  const doCampo = (prefix: string) => (items: ValidacaoItem[]) =>
    items.filter((i) => i.campo === prefix || i.campo.startsWith(`${prefix}.`));
  const errosDe = (p: string) => doCampo(p)(erros);
  const avisosDe = (p: string) => doCampo(p)(avisos);

  const setSlots = (f: Face, slots: PerfilSlot[]) =>
    onChange({ ...perfil, slots: { ...perfil.slots, [f]: slots } });

  const gerarPelaGrade = () => {
    const hasManual = perfil.posicionamento === "manual" && perfil.slots[faceAtual].length > 0;
    if (
      hasManual &&
      !window.confirm(
        "Gerar pela grade substitui as posições ajustadas à mão desta face. Continuar?",
      )
    ) {
      return;
    }
    onChange({
      ...perfil,
      posicionamento: "grade",
      slots: { ...perfil.slots, [faceAtual]: gerarSlotsPelaGrade(perfil, pagGrade) },
    });
    setSelectedId(null);
  };

  const setPosicionamento = (p: PerfilImposicao["posicionamento"]) => {
    if (p === perfil.posicionamento) return;
    if (p === "manual") {
      onChange(converterParaManual(perfil));
      return;
    }
    if (!window.confirm("Voltar para a grade recalcula as posições pela grade e descarta os X/Y manuais. Continuar?")) {
      return;
    }
    onChange({
      ...perfil,
      posicionamento: "grade",
      slots: {
        frente: gerarSlotsPelaGrade(perfil, perfil.slots.frente[0]?.pagina ?? 1),
        verso: duplex ? gerarSlotsPelaGrade(perfil, perfil.slots.verso[0]?.pagina ?? 2) : [],
      },
    });
  };

  /** Recebe o novo centro da página (X/Y do modo manual). */
  const moveSlot = (id: number, x: number, y: number) => {
    setSlots(
      faceAtual,
      perfil.slots[faceAtual].map((s) => (s.id === id ? { ...s, x_mm: x, y_mm: y } : s)),
    );
  };

  const capacidade = perfil.slots.frente.length;
  const folhaResumo =
    perfil.folha.largura_mm && perfil.folha.altura_mm
      ? `${formatMm(perfil.folha.largura_mm)} × ${formatMm(perfil.folha.altura_mm)} mm`
      : "não definida";
  const paginaResumo =
    perfil.pagina.fonte === "pdf"
      ? "lida do PDF"
      : perfil.pagina.largura_mm && perfil.pagina.altura_mm
        ? `${formatMm(perfil.pagina.largura_mm)} × ${formatMm(perfil.pagina.altura_mm)} mm`
        : "não definida";
  const presetAtual =
    FOLHA_PRESETS.find(
      (p) =>
        (p.largura === perfil.folha.largura_mm && p.altura === perfil.folha.altura_mm) ||
        (p.altura === perfil.folha.largura_mm && p.largura === perfil.folha.altura_mm),
    )?.id ?? "custom";
  const juntadaRegra = REGRA_TIRAGEM_INFO[perfil.juntada.regra_tiragem];
  const pastaSaida = (perfil.saida.pasta_pdf ?? "").trim();
  const saidaResumo = pastaSaida
    ? `PDF em ${pastaSaida}`
    : `PDF em ${perfil.saida.destino_pdf === "offset" ? "Offset" : "Digital"}${perfil.saida.jdf_hotfolder ? " · hotfolder próprio" : ""}`;
  const resolvidos = resolverSlots(perfil, faceAtual);
  const selecionado = resolvidos.find((s) => s.id === selectedId);
  const outrosProdutos = produtos.filter(
    (p) => p.trim().toLowerCase() !== (produtoAtual ?? "").trim().toLowerCase(),
  );

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex min-w-0 flex-col gap-3">
        <Section n={1} title="Folha" resumo={folhaResumo} problems={errosDe("folha").length}>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <label className={labelCls}>
              Tamanho
              <select
                className={inputCls}
                value={presetAtual}
                onChange={(e) => {
                  const p = FOLHA_PRESETS.find((x) => x.id === e.target.value);
                  if (p) set("folha", { largura_mm: p.largura, altura_mm: p.altura });
                }}
              >
                <option value="custom">Personalizado</option>
                {FOLHA_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="sagra-btn sagra-btn--outline sagra-btn--sm"
              title="Trocar largura e altura"
              onClick={() =>
                set("folha", { largura_mm: perfil.folha.altura_mm, altura_mm: perfil.folha.largura_mm })
              }
            >
              <RotateCw className="size-3.5" aria-hidden /> Girar
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <NumberInput
              label="Largura (mm)"
              value={perfil.folha.largura_mm}
              onChange={(n) => set("folha", { ...perfil.folha, largura_mm: n })}
            />
            <NumberInput
              label="Altura (mm)"
              value={perfil.folha.altura_mm}
              onChange={(n) => set("folha", { ...perfil.folha, altura_mm: n })}
            />
          </div>
          <FieldMessages items={errosDe("folha")} tone="erro" />
        </Section>

        <Section n={2} title="Página (arte)" resumo={paginaResumo} problems={errosDe("pagina").length}>
          <Segmented
            ariaLabel="Tamanho da página"
            value={perfil.pagina.fonte}
            options={[
              { id: "fixa", label: "Tamanho fixo" },
              { id: "pdf", label: "Ler do PDF da OS" },
            ]}
            onChange={(fonte) => set("pagina", { ...perfil.pagina, fonte })}
          />
          {perfil.pagina.fonte === "fixa" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <NumberInput
                label="Largura (mm)"
                value={perfil.pagina.largura_mm}
                onChange={(n) => set("pagina", { ...perfil.pagina, largura_mm: n })}
              />
              <NumberInput
                label="Altura (mm)"
                value={perfil.pagina.altura_mm}
                onChange={(n) => set("pagina", { ...perfil.pagina, altura_mm: n })}
              />
            </div>
          ) : (
            <p className={hintCls}>
              Usa o tamanho do BaseSefoc.pdf de cada OS. Só funciona com posicionamento pela grade.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <NumberInput
              label="Sangria (mm)"
              value={perfil.sangria_mm}
              onChange={(n) => set("sangria_mm", n ?? 0)}
              hint="0 = corte seco. Conta para a checagem de “fora da folha”."
            />
            <label className={labelCls}>
              Impressão
              <select
                className={inputCls}
                value={perfil.faces}
                onChange={(e) => {
                  const faces = e.target.value as PerfilImposicao["faces"];
                  onChange({
                    ...perfil,
                    faces,
                    slots: {
                      frente: perfil.slots.frente,
                      verso:
                        faces === "frente_verso"
                          ? perfil.slots.verso.length
                            ? perfil.slots.verso
                            : perfil.slots.frente.map((s) => ({ ...s, pagina: s.pagina + 1 }))
                          : [],
                    },
                  });
                  if (faces === "frente") setFace("frente");
                }}
              >
                <option value="frente">Só frente (Simplex)</option>
                <option value="frente_verso">Frente e verso (Duplex)</option>
              </select>
            </label>
          </div>
          {usaVariasPaginas ? (
            <Toggle
              label="Gerar mesmo quando o PDF da OS vier com menos páginas"
              checked={(perfil.paginas_faltantes ?? "adaptar") === "adaptar"}
              onChange={(v) => set("paginas_faltantes", v ? "adaptar" : "erro")}
              hint={
                duplex
                  ? "Slots cujas páginas não existem no PDF ficam vazios. Se nenhuma página do verso existir (ex.: PDF só com a página 1), o JDF sai só frente."
                  : "Slots cujas páginas não existem no PDF ficam vazios. Desmarcado, a geração é recusada se faltar alguma página."
              }
            />
          ) : null}
          <FieldMessages items={[...errosDe("pagina"), ...errosDe("sangria_mm")]} tone="erro" />
          <FieldMessages items={avisosDe("pagina")} tone="aviso" />
        </Section>

        <Section
          n={3}
          title="Grade"
          resumo={`${perfil.grade.colunas} × ${perfil.grade.linhas} · ${perfil.posicionamento === "grade" ? "posições pela grade" : "posições manuais"}`}
          problems={errosDe("posicionamento").length}
        >
          <div className="grid gap-3 sm:grid-cols-4">
            <NumberInput
              label="Colunas"
              step={1}
              min={1}
              value={perfil.grade.colunas}
              onChange={(n) => set("grade", { ...perfil.grade, colunas: Math.max(1, Math.floor(n ?? 1)) })}
            />
            <NumberInput
              label="Linhas"
              step={1}
              min={1}
              value={perfil.grade.linhas}
              onChange={(n) => set("grade", { ...perfil.grade, linhas: Math.max(1, Math.floor(n ?? 1)) })}
            />
            <NumberInput
              label="Espaço horizontal"
              value={perfil.grade.espaco_h_mm}
              onChange={(n) => set("grade", { ...perfil.grade, espaco_h_mm: n ?? 0 })}
            />
            <NumberInput
              label="Espaço vertical"
              value={perfil.grade.espaco_v_mm}
              onChange={(n) => set("grade", { ...perfil.grade, espaco_v_mm: n ?? 0 })}
            />
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className={labelCls}>
              Alinhamento na folha
              <select
                className={inputCls}
                value={perfil.grade.alinhamento}
                onChange={(e) =>
                  set("grade", { ...perfil.grade, alinhamento: e.target.value as PerfilImposicao["grade"]["alinhamento"] })
                }
              >
                <option value="centro">Centralizado</option>
                <option value="topo_esquerda">Topo à esquerda</option>
              </select>
            </label>
            <label className={cn(labelCls, "w-24")}>
              Página
              <input
                type="number"
                min={1}
                className={inputCls}
                value={pagGrade}
                onChange={(e) => setPagGrade(Math.max(1, Math.floor(Number(e.target.value)) || 1))}
              />
            </label>
            <button type="button" className="sagra-btn sagra-btn--primary-outline sagra-btn--sm" onClick={gerarPelaGrade}>
              <LayoutGrid className="size-3.5" aria-hidden /> Gerar posições pela grade
              {duplex ? ` (${faceAtual})` : ""}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-600">Posicionamento:</span>
            <Segmented
              ariaLabel="Posicionamento"
              value={perfil.posicionamento}
              options={[
                { id: "grade", label: "Pela grade" },
                { id: "manual", label: "Manual (X/Y)" },
              ]}
              onChange={setPosicionamento}
            />
          </div>
          <p className={hintCls}>
            Pela grade: as posições acompanham a grade e o tamanho da página. Manual: cada slot tem X/Y
            próprio, que é o centro da página, medido do canto inferior esquerdo da folha (mm, Y para cima).
          </p>
          <FieldMessages items={errosDe("posicionamento")} tone="erro" />
        </Section>

        <Section
          n={4}
          title="Posições"
          resumo={`${perfil.slots.frente.length} slot(s)${duplex ? ` + ${perfil.slots.verso.length} no verso` : ""}`}
          problems={errosDe("slots").length}
        >
          {duplex ? (
            <Segmented
              ariaLabel="Face"
              value={faceAtual}
              options={[
                { id: "frente", label: "Frente" },
                { id: "verso", label: "Verso" },
              ]}
              onChange={(f) => {
                setFace(f);
                setSelectedId(null);
              }}
            />
          ) : null}
          <SlotsTable
            perfil={perfil}
            face={faceAtual}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onChange={(slots) => setSlots(faceAtual, slots)}
          />
          <FieldMessages items={errosDe("slots")} tone="erro" />
          <FieldMessages items={avisosDe("slots")} tone="aviso" />
        </Section>

        <Section
          n={5}
          title="Marcas"
          resumo={
            perfil.marcas.ativo
              ? perfil.marcas.arquivo
                ? perfil.marcas.nome_original ?? "PDF no servidor"
                : perfil.marcas.pdf_path
                  ? "caminho de rede"
                  : "sem PDF"
              : "sem marcas"
          }
          problems={errosDe("marcas").length}
        >
          <Toggle
            label="Usar PDF de marcas"
            checked={perfil.marcas.ativo}
            onChange={(v) =>
              set("marcas", { ...perfil.marcas, ativo: v, carimbar_op: v ? perfil.marcas.carimbar_op : false })
            }
            hint="Entra no JDF como conteúdo da folha (não marcas automáticas do Apogee). Deve ter o tamanho da folha."
          />
          {perfil.marcas.ativo ? (
            <>
              <input
                ref={marcasFileRef}
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                data-testid="marcas-pdf-input"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f && onEnviarMarcas) onEnviarMarcas(f);
                  e.target.value = "";
                }}
              />
              {perfil.marcas.arquivo ? (
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <FileText className="size-5 shrink-0 text-secondary-blue" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-slate-800">
                      {perfil.marcas.nome_original ?? "PDF de marcas"}
                    </p>
                    <p
                      className={cn(
                        "text-[11px]",
                        marcasArquivoInfo && marcasArquivoInfo.existe === false
                          ? "text-red-600"
                          : marcasTamanhoDiverge(marcasArquivoInfo)
                            ? "text-red-600"
                            : "text-slate-500",
                      )}
                    >
                      {marcasArquivoInfo
                        ? marcasArquivoInfo.existe === false
                          ? "Não encontrado no servidor — envie de novo."
                          : `Guardado no servidor · ${formatMm(marcasArquivoInfo.largura_mm)} × ${formatMm(marcasArquivoInfo.altura_mm)} mm · ${marcasArquivoInfo.paginas ?? "?"} página${marcasArquivoInfo.paginas === 1 ? "" : "s"}`
                        : "Guardado no servidor"}
                    </p>
                  </div>
                  {marcasArquivoUrl ? (
                    <a
                      className="sagra-btn sagra-btn--outline sagra-btn--xs"
                      href={marcasArquivoUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Abrir
                    </a>
                  ) : null}
                  <button
                    type="button"
                    className="sagra-btn sagra-btn--outline sagra-btn--xs"
                    disabled={marcasEnviando}
                    onClick={() => marcasFileRef.current?.click()}
                  >
                    {marcasEnviando ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
                    Trocar arquivo
                  </button>
                  <button
                    type="button"
                    className="sagra-btn sagra-btn--delete-outline sagra-btn--xs"
                    onClick={() =>
                      set("marcas", { ...perfil.marcas, arquivo: null, nome_original: null })
                    }
                  >
                    Remover
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    className="flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-xs text-slate-600 hover:border-secondary-blue hover:text-secondary-blue disabled:opacity-60"
                    disabled={marcasEnviando || !onEnviarMarcas}
                    onClick={() => marcasFileRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const f = e.dataTransfer.files?.[0];
                      if (f && onEnviarMarcas) onEnviarMarcas(f);
                    }}
                  >
                    {marcasEnviando ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <UploadCloud className="size-5" aria-hidden />
                    )}
                    <span className="font-semibold">
                      {marcasEnviando ? "Enviando ao servidor…" : "Enviar PDF de marcas"}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      Clique ou arraste o arquivo. Ele fica guardado no servidor.
                    </span>
                  </button>
                  {perfil.marcas.pdf_path ? (
                    <div className="flex flex-col gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                      <span>
                        Este perfil ainda usa um caminho de rede:{" "}
                        <span className="break-all font-mono">{perfil.marcas.pdf_path}</span>. Copie o
                        arquivo para o servidor para não depender dele.
                      </span>
                      <button
                        type="button"
                        className="sagra-btn sagra-btn--outline sagra-btn--xs self-start"
                        disabled={marcasEnviando || !onImportarMarcas}
                        onClick={() => perfil.marcas.pdf_path && onImportarMarcas?.(perfil.marcas.pdf_path)}
                      >
                        Copiar este arquivo para o servidor
                      </button>
                    </div>
                  ) : null}
                  <details className="text-xs text-slate-600">
                    <summary className="cursor-pointer select-none text-[11px] text-slate-500">
                      Usar caminho de rede (avançado)
                    </summary>
                    <div className="mt-2 flex flex-col gap-1">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          className={cn(inputCls, "font-mono")}
                          value={perfil.marcas.pdf_path ?? ""}
                          placeholder={"\\\\servidor\\pasta\\marcas.pdf"}
                          onChange={(e) => set("marcas", { ...perfil.marcas, pdf_path: e.target.value || null })}
                          onBlur={(e) => {
                            const v = e.target.value.trim();
                            if (v && onVerificarMarcas) onVerificarMarcas(v);
                          }}
                        />
                        <button
                          type="button"
                          className="sagra-btn sagra-btn--outline sagra-btn--sm"
                          disabled={!perfil.marcas.pdf_path || marcasInfoLoading}
                          onClick={() => perfil.marcas.pdf_path && onVerificarMarcas?.(perfil.marcas.pdf_path)}
                        >
                          Verificar
                        </button>
                      </div>
                      {marcasInfoLoading ? (
                        <p className={hintCls}>Verificando PDF…</p>
                      ) : marcasInfo ? (
                        marcasInfo.existe ? (
                          <p className={cn("text-[11px]", marcasTamanhoDiverge(marcasInfo) ? "text-red-600" : "text-emerald-700")}>
                            ✓ {formatMm(marcasInfo.largura_mm)} × {formatMm(marcasInfo.altura_mm)} mm,{" "}
                            {marcasInfo.paginas} página{marcasInfo.paginas === 1 ? "" : "s"}
                          </p>
                        ) : (
                          <p className="text-[11px] text-amber-700">{marcasInfo.erro}</p>
                        )
                      ) : null}
                      <span className={hintCls}>
                        O Apogee lê o arquivo direto da rede. Prefira enviar o PDF ao servidor.
                      </span>
                    </div>
                  </details>
                </div>
              )}
              <Toggle
                label="Carimbar o número da OP no PDF de marcas"
                checked={perfil.marcas.carimbar_op}
                onChange={(v) => set("marcas", { ...perfil.marcas, carimbar_op: v })}
                hint="Substitui o texto TxtOPs do PDF pelos números das OSs da folha."
              />
            </>
          ) : null}
          <FieldMessages items={errosDe("marcas")} tone="erro" />
          <FieldMessages items={avisosDe("marcas")} tone="aviso" />
        </Section>

        <Section
          n={6}
          title="Arte e juntada"
          resumo={[
            perfil.arte.fonte === "pre_impresso" ? "pré-impresso" : "BaseSefoc.pdf",
            perfil.juntada.ativo ? `juntada até ${perfil.juntada.max_os ?? capacidade} OSs` : "sem juntada",
          ].join(" · ")}
          problems={errosDe("arte").length + errosDe("juntada").length}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelCls}>
              Fonte da arte
              <select
                className={inputCls}
                value={perfil.arte.fonte}
                onChange={(e) => set("arte", { ...perfil.arte, fonte: e.target.value as PerfilImposicao["arte"]["fonte"] })}
              >
                <option value="base_sefoc">BaseSefoc.pdf da OS</option>
                <option value="pre_impresso">Pré-impresso (exporta o CDR sem brasão)</option>
              </select>
              <span className={hintCls}>
                Pré-impresso gera o PDF no worker Corel e monta uma arte por slot.
              </span>
            </label>
            <label className={labelCls}>
              Rotação das artes
              <select
                className={inputCls}
                value={perfil.arte.rotacao}
                onChange={(e) => set("arte", { ...perfil.arte, rotacao: e.target.value as PerfilImposicao["arte"]["rotacao"] })}
              >
                <option value="no_jdf">No JDF (Apogee gira)</option>
                <option value="no_pdf">No PDF (páginas giradas antes do JDF)</option>
              </select>
              <span className={hintCls}>No PDF exige pré-impresso e slots com a mesma orientação.</span>
            </label>
          </div>
          <Toggle
            label="Permitir juntar OSs na mesma folha"
            checked={perfil.juntada.ativo}
            onChange={(v) => set("juntada", { ...perfil.juntada, ativo: v })}
            hint={`Capacidade: ${capacidade} slot${capacidade === 1 ? "" : "s"} (seção 4). Exige arte pré-impressa.`}
          />
          {perfil.juntada.ativo ? (
            <div className="flex flex-col gap-3 rounded-lg bg-slate-50 p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className={labelCls}>
                  Andamento das OSs candidatas
                  <select
                    className={inputCls}
                    value={perfil.juntada.situacao_candidatas ?? ""}
                    onChange={(e) =>
                      set("juntada", { ...perfil.juntada, situacao_candidatas: e.target.value || null })
                    }
                  >
                    <option value="">Mesmo andamento da OS que está gerando</option>
                    {situacoes.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
                <NumberInput
                  label="Máximo de OSs por folha"
                  step={1}
                  min={1}
                  value={perfil.juntada.max_os}
                  onChange={(n) => set("juntada", { ...perfil.juntada, max_os: n ? Math.floor(n) : null })}
                  hint={`Vazio = até ${capacidade} (um por slot).`}
                />
              </div>
              <label className={labelCls}>
                Regra de tiragem
                <select
                  className={inputCls}
                  value={perfil.juntada.regra_tiragem}
                  onChange={(e) =>
                    set("juntada", { ...perfil.juntada, regra_tiragem: e.target.value as RegraTiragem })
                  }
                >
                  {(Object.keys(REGRA_TIRAGEM_INFO) as RegraTiragem[]).map((r) => (
                    <option key={r} value={r}>
                      {REGRA_TIRAGEM_INFO[r].label}
                    </option>
                  ))}
                </select>
                <span className={hintCls}>
                  {juntadaRegra.descricao} Ex.: {juntadaRegra.exemplo}
                </span>
              </label>
              <Toggle
                label="Preencher todos os slots"
                checked={perfil.juntada.preencher_todos_slots}
                onChange={(v) => set("juntada", { ...perfil.juntada, preencher_todos_slots: v })}
                hint="Duplica as artes para ocupar a folha inteira (ex.: 1 OS em 2 slots imprime 2 por folha)."
              />
              <fieldset className="flex flex-col gap-1">
                <legend className="text-xs text-slate-600">Outros produtos que podem entrar na mesma folha</legend>
                {outrosProdutos.length === 0 ? (
                  <span className={hintCls}>Nenhum outro produto cadastrado.</span>
                ) : (
                  <div className="flex max-h-32 flex-wrap gap-x-4 gap-y-1 overflow-y-auto">
                    {outrosProdutos.map((p) => {
                      const checked = perfil.juntada.produtos_compativeis.some(
                        (c) => c.toLowerCase() === p.toLowerCase(),
                      );
                      return (
                        <label key={p} className="inline-flex items-center gap-1.5 text-xs text-slate-700">
                          <input
                            type="checkbox"
                            className="size-3.5"
                            checked={checked}
                            onChange={(e) =>
                              set("juntada", {
                                ...perfil.juntada,
                                produtos_compativeis: e.target.checked
                                  ? [...perfil.juntada.produtos_compativeis, p]
                                  : perfil.juntada.produtos_compativeis.filter(
                                      (c) => c.toLowerCase() !== p.toLowerCase(),
                                    ),
                              })
                            }
                          />
                          {p}
                        </label>
                      );
                    })}
                  </div>
                )}
                <span className={hintCls}>O próprio produto sempre pode.</span>
              </fieldset>
            </div>
          ) : null}
          <FieldMessages items={[...errosDe("arte"), ...errosDe("juntada")]} tone="erro" />
        </Section>

        <Section
          n={7}
          title="Saída"
          defaultOpen={false}
          resumo={saidaResumo}
          problems={errosDe("saida").length}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelCls}>
              Pasta do PDF imposto na OS
              <select
                className={inputCls}
                value={perfil.saida.destino_pdf}
                onChange={(e) =>
                  set("saida", { ...perfil.saida, destino_pdf: e.target.value as PerfilImposicao["saida"]["destino_pdf"] })
                }
              >
                <option value="digital">Digital</option>
                <option value="offset">Offset</option>
              </select>
              <span className={hintCls}>
                Pasta padrão na OS, usada quando o caminho abaixo está vazio. Também define o nome do arquivo.
              </span>
            </label>
            <label className={labelCls}>
              Hotfolder JDF (Apogee)
              <input
                type="text"
                className={cn(inputCls, "font-mono")}
                value={perfil.saida.jdf_hotfolder ?? ""}
                placeholder="Padrão do sistema"
                onChange={(e) => set("saida", { ...perfil.saida, jdf_hotfolder: e.target.value || null })}
              />
              <span className={hintCls}>Vazio = hotfolder padrão do servidor.</span>
            </label>
            <label className={cn(labelCls, "sm:col-span-2")}>
              Pasta de saída do PDF imposto
              <input
                type="text"
                className={cn(inputCls, "font-mono")}
                data-testid="imposicao-saida-pasta-pdf"
                value={perfil.saida.pasta_pdf ?? ""}
                placeholder={"\\\\servidor\\pasta\\saida"}
                maxLength={512}
                onChange={(e) =>
                  set("saida", { ...perfil.saida, pasta_pdf: e.target.value.trim() ? e.target.value : null })
                }
              />
              <span className={hintCls}>
                Caminho absoluto (UNC ou unidade) para onde o PDF devolvido pelo Apogee é movido.
                Em branco, usa a pasta Digital ou Offset da OS.
              </span>
            </label>
          </div>
          <FieldMessages items={errosDe("saida")} tone="erro" />
        </Section>
      </div>

      <div className="min-w-0 xl:sticky xl:top-2 xl:self-start">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Preview{duplex ? ` · ${faceAtual}` : ""}
          </p>
          {selecionado ? (
            <p className="text-[11px] text-slate-600">
              Slot {selecionado.id}: centro X {formatMm(selecionado.cx_mm)} · Y{" "}
              {formatMm((folhaMm(perfil)?.h ?? 0) - selecionado.cy_mm)} ·{" "}
              {formatMm(selecionado.largura_mm)} × {formatMm(selecionado.altura_mm)} mm
            </p>
          ) : null}
        </div>
        <PerfilImposicaoPreview
          perfil={perfil}
          face={faceAtual}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onMove={moveSlot}
          backgroundUrl={backgroundUrl}
        />
      </div>
    </div>
  );
}
