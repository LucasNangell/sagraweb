import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "@sagra/ui";
import { ArrowLeft, CheckCircle2, FileText, FileUp, Loader2, UploadCloud, X } from "lucide-react";
import { useMemo, useRef, useState, type DragEvent } from "react";

import { createPapelariaModeloFromPdf, savePapelariaProdutoMockup } from "@/api/adminSystem";
import type { PapelariaAdminModelRecord } from "@/features/configuracoes/types";
import { PAPELARIA_MOCKUP_CONFIGS } from "@/features/papelaria/mockup/papelariaMockupConfigs";

import { Field, InlineMessage, normalizeSearch, SegmentedControl } from "./PapelariaWorkspaceUi";

const PRESET_OPTIONS = [
  { id: "folha_a4_simples", label: "Folha simples", hint: "Folha única, sem dobra" },
  { id: "cartao_visita_frente", label: "Cartão simples", hint: "Cartão com uma face" },
  { id: "cartao_visita_frente_verso", label: "Cartão frente e verso", hint: "Cartão que gira para mostrar o verso" },
  { id: "cartao_duplo_retrato_lateral", label: "Cartão dobrado lateral", hint: "Dobra vertical, abre como livro" },
  { id: "folha_simples", label: "Fallback genérico", hint: "Preset neutro para casos não previstos" },
] as const;

// Frentes e versos são sempre cadastrados separadamente.
const FACES = ["Frente", "Verso"] as const;
type FaceCadastro = (typeof FACES)[number];
const CORES_OPCOES = ["Policromia", "Relev Seco", "Port/Inglês"];
const MAX_PDF_BYTES = 30 * 1024 * 1024;

/**
 * Cadastro de uma frente ou de um verso a partir do PDF exportado do
 * CorelDRAW (modo Prova PDF) — sem .cdr. Depois de criado, os textos do PDF
 * são ligados aos campos em «Textos e prévia».
 */
export function PapelariaNovoModeloForm({
  lockedProduto,
  produtosExistentes,
  faceInicial,
  onCreated,
  onCancel,
}: {
  lockedProduto?: string | null;
  /** Nomes já cadastrados — avisa quando o "novo" produto já existe. */
  produtosExistentes?: string[];
  /** «Nova frente» / «Novo verso». */
  faceInicial?: "frente" | "verso";
  onCreated: (modelo: PapelariaAdminModelRecord) => void;
  onCancel?: () => void;
}) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [produtoNovo, setProdutoNovo] = useState("");
  const [face, setFace] = useState<FaceCadastro>(faceInicial === "verso" ? "Verso" : "Frente");
  const [cores, setCores] = useState("Policromia");
  const [nomeExibicao, setNomeExibicao] = useState("");
  const [presetId, setPresetId] =
    useState<keyof typeof PAPELARIA_MOCKUP_CONFIGS>("folha_a4_simples");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const produtoFinal = (lockedProduto ?? produtoNovo).trim();

  const produtoJaExiste = useMemo(() => {
    if (lockedProduto || !produtoNovo.trim()) return null;
    const alvo = normalizeSearch(produtoNovo);
    return (produtosExistentes ?? []).find((p) => normalizeSearch(p) === alvo) ?? null;
  }, [lockedProduto, produtoNovo, produtosExistentes]);

  /** Produto novo: escolhe o mockup inicial do produto. Produto existente já tem o seu. */
  const pedeMockup = !lockedProduto && !produtoJaExiste;

  const escolherArquivo = (file: File | null) => {
    setLocalError(null);
    if (!file) {
      setPdfFile(null);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setLocalError("Envie o PDF do modelo (exportado do CorelDRAW).");
      return;
    }
    if (file.size > MAX_PDF_BYTES) {
      setLocalError("PDF maior que 30 MB.");
      return;
    }
    setPdfFile(file);
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!pdfFile) throw new Error("Selecione o PDF do modelo.");
      const criado = await createPapelariaModeloFromPdf({
        produto: produtoFinal,
        frenteVerso: face,
        cores,
        nomeExibicao: nomeExibicao.trim() || undefined,
        file: pdfFile,
      });
      // Mockup 3D é do produto: só o produto novo recebe o preset inicial.
      if (pedeMockup) {
        try {
          await savePapelariaProdutoMockup(
            produtoFinal,
            face === "Frente" ? "frente" : "frente_verso",
            JSON.stringify(PAPELARIA_MOCKUP_CONFIGS[presetId]),
          );
        } catch {
          /* modelo já criado; o mockup pode ser ajustado depois em Mockup 3D */
        }
      }
      return criado;
    },
    onSuccess: (data) => {
      setLocalError(null);
      setPdfFile(null);
      if (fileRef.current) fileRef.current.value = "";
      void qc.invalidateQueries({ queryKey: ["admin", "papelaria-modelos"] });
      void qc.invalidateQueries({ queryKey: ["admin", "papelaria-produtos"] });
      void qc.invalidateQueries({ queryKey: ["admin", "papelaria-produto-mockup"] });
      void qc.invalidateQueries({ queryKey: ["papelaria", "faces"] });
      onCreated(data);
    },
    onError: (err: Error) => setLocalError(err.message),
  });

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    escolherArquivo(e.dataTransfer.files?.[0] ?? null);
  };

  const ehVerso = face === "Verso";
  const pendencia = !pdfFile
    ? "Selecione o PDF do modelo."
    : !produtoFinal
      ? "Informe o nome do produto."
      : null;

  return (
    <div className="pw-panel pw-scroll">
      <div className="pw-form">
        <div className="pw-form__header">
          {onCancel ? (
            <button type="button" className="pw-icon-btn" aria-label="Voltar" title="Voltar" onClick={onCancel}>
              <ArrowLeft className="size-4" aria-hidden />
            </button>
          ) : null}
          <div className="min-w-0">
            <h3 className="text-base font-bold text-slate-800">
              {lockedProduto ? `${ehVerso ? "Novo verso" : "Nova frente"} em ${lockedProduto}` : "Novo produto"}
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Envie o PDF {ehVerso ? "do verso" : "da frente"} exportado do CorelDRAW. Depois, em «Textos e
              prévia», ligue os textos do PDF aos campos do formulário.
            </p>
          </div>
        </div>

        {/* 1. PDF */}
        <fieldset className="pw-step">
          <legend className="pw-step__legend">
            <span className="pw-step__num">1</span> PDF {ehVerso ? "do verso" : "da frente"}
          </legend>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            data-testid="pw-novo-pdf-input"
            onChange={(e) => escolherArquivo(e.target.files?.[0] ?? null)}
          />
          {pdfFile ? (
            <div className="pw-file-row">
              <CheckCircle2 className="size-4 shrink-0 text-emerald-600" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-[11px] font-medium text-slate-800">{pdfFile.name}</p>
                <p className="text-[10px] text-slate-500">{(pdfFile.size / 1024).toFixed(0)} KB</p>
              </div>
              <button
                type="button"
                className="sagra-btn sagra-btn--outline sagra-btn--xs"
                onClick={() => fileRef.current?.click()}
              >
                Trocar
              </button>
              <button
                type="button"
                className="pw-icon-btn"
                aria-label="Remover arquivo"
                title="Remover arquivo"
                onClick={() => escolherArquivo(null)}
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </div>
          ) : (
            <div
              role="button"
              tabIndex={0}
              className={cn("pw-dropzone", dragOver && "is-over")}
              onClick={() => fileRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileRef.current?.click();
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
            >
              <UploadCloud className="size-6 text-slate-400" aria-hidden />
              <p className="text-xs font-semibold text-slate-700">
                Arraste o PDF aqui ou <span className="text-secondary-blue underline">escolha o arquivo</span>
              </p>
              <p className="text-[10px] text-slate-500">
                Exporte do CorelDRAW com «Incorporar fontes no documento», sem subconjunto de fontes e com os
                textos como texto (não curvas).
              </p>
            </div>
          )}
        </fieldset>

        {/* 2. Identificação */}
        <fieldset className="pw-step">
          <legend className="pw-step__legend">
            <span className="pw-step__num">2</span> Identificação
          </legend>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Produto" htmlFor="pw-novo-produto">
              {lockedProduto ? (
                <input id="pw-novo-produto" className="pw-input" value={lockedProduto} readOnly />
              ) : (
                <input
                  id="pw-novo-produto"
                  className="pw-input"
                  value={produtoNovo}
                  onChange={(e) => setProdutoNovo(e.target.value)}
                  placeholder="Ex.: Cartão de visita"
                  autoComplete="off"
                />
              )}
            </Field>
            <Field label="Nome de exibição (opcional)" htmlFor="pw-novo-nome">
              <input
                id="pw-novo-nome"
                className="pw-input"
                value={nomeExibicao}
                onChange={(e) => setNomeExibicao(e.target.value)}
                maxLength={255}
                placeholder={ehVerso ? "Ex.: Verso assessor" : "Ex.: Frente padrão"}
              />
            </Field>
            <Field label="Face" hint="Em produto frente e verso, a prova junta a frente e o verso escolhidos.">
              <SegmentedControl
                ariaLabel="Face do modelo"
                size="sm"
                value={face}
                onChange={setFace}
                options={FACES.map((v) => ({ id: v, label: v }))}
              />
            </Field>
            <Field label="Perfil de cores">
              <SegmentedControl
                ariaLabel="Perfil de cores"
                size="sm"
                value={cores}
                onChange={setCores}
                options={CORES_OPCOES.map((c) => ({ id: c, label: c }))}
              />
            </Field>
          </div>
          {produtoJaExiste ? (
            <InlineMessage tone="info" className="mt-2">
              Já existe o produto “{produtoJaExiste}”. {ehVerso ? "O verso será adicionado" : "A frente será adicionada"}{" "}
              a ele se o nome for idêntico.
            </InlineMessage>
          ) : null}
        </fieldset>

        {/* 3. Mockup do produto (só produto novo) */}
        {pedeMockup ? (
          <fieldset className="pw-step">
            <legend className="pw-step__legend">
              <span className="pw-step__num">3</span> Mockup 3D do produto
            </legend>
            <div className="pw-preset-grid" role="radiogroup" aria-label="Preset de mockup inicial">
              {PRESET_OPTIONS.map((p) => {
                const active = presetId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={cn("pw-preset", active && "is-active")}
                    onClick={() => setPresetId(p.id)}
                  >
                    <span className="pw-preset__label">{p.label}</span>
                    <span className="pw-preset__hint">{p.hint}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>
        ) : null}

        {localError ? <InlineMessage tone="error">{localError}</InlineMessage> : null}

        <div className="pw-form__footer">
          <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
            <FileText className="size-3.5" aria-hidden />
            {pendencia ?? `Tudo pronto. Em seguida você liga os textos ${ehVerso ? "do verso" : "da frente"} aos campos.`}
          </span>
          <div className="flex flex-wrap gap-2">
            {onCancel ? (
              <button type="button" className="sagra-btn sagra-btn--outline sagra-btn--sm" onClick={onCancel}>
                Cancelar
              </button>
            ) : null}
            <button
              type="button"
              className="sagra-btn sagra-btn--add sagra-btn--sm"
              disabled={Boolean(pendencia) || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <FileUp className="size-3.5" aria-hidden />
              )}
              {ehVerso ? "Criar verso" : "Criar frente"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
