import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText, FolderOpen, Layers, Loader2, RotateCcw, Save, Tag, Trash2, Upload } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";

import {
  clearPapelariaProvaEmailTemplate,
  deletePapelariaAdminModelo,
  savePapelariaAdminModeloPadrao,
  savePapelariaAdminNomeExibicao,
  savePapelariaAdminPastaImposicao,
  uploadPapelariaProvaEmailTemplate,
} from "@/api/adminSystem";
import { toast } from "@/components/ui/toastStore";
import type { PapelariaAdminModelRecord } from "@/features/configuracoes/types";

import { Field, InlineMessage, PanelCard, StatusPill } from "./PapelariaWorkspaceUi";

type Erros = Partial<Record<"nome" | "pasta" | "template" | "excluir" | "padrao", string>>;

/** Faces que o modelo oferece: frente e verso (pág. 1 e 2), só frente ou só verso. */
function facesDoModelo(frenteVersao: string | null | undefined): Array<"frente" | "verso"> {
  const v = (frenteVersao ?? "").toLowerCase();
  if (v.includes("frente") && v.includes("verso")) return ["frente", "verso"];
  if (v.includes("verso")) return ["verso"];
  return ["frente"];
}

export function PapelariaModeloDadosPanel({
  modelo,
  onDeleted,
}: {
  modelo: PapelariaAdminModelRecord;
  onDeleted?: (modeloId: number) => void;
}) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [nome, setNome] = useState(modelo.nome_exibicao);
  const [pastaImposicao, setPastaImposicao] = useState(modelo.pasta_imposicao ?? "");
  const [templatePath, setTemplatePath] = useState(modelo.prova_email_template_pdf ?? "");
  const [erros, setErros] = useState<Erros>({});

  const setErro = (k: keyof Erros, msg?: string) => setErros((prev) => ({ ...prev, [k]: msg }));
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["admin", "papelaria-modelos"] });

  const saveNomeMutation = useMutation({
    mutationFn: () => {
      const trimmed = nome.trim();
      return savePapelariaAdminNomeExibicao(modelo.id, trimmed || null);
    },
    onSuccess: (data) => {
      setErro("nome");
      setNome(data.nome_exibicao);
      toast.success("Nome de exibição salvo.");
      invalidate();
    },
    onError: (err: Error) => setErro("nome", err.message),
  });

  const savePastaMutation = useMutation({
    mutationFn: () => {
      const trimmed = pastaImposicao.trim();
      return savePapelariaAdminPastaImposicao(modelo.id, trimmed || null);
    },
    onSuccess: (data) => {
      setErro("pasta");
      setPastaImposicao(data.pasta_imposicao ?? "");
      toast.success("Pasta de imposição salva.");
      invalidate();
    },
    onError: (err: Error) => setErro("pasta", err.message),
  });

  const uploadTemplateMutation = useMutation({
    mutationFn: (file: File) => uploadPapelariaProvaEmailTemplate(modelo.id, file),
    onSuccess: (data) => {
      setErro("template");
      setTemplatePath(data.prova_email_template_pdf ?? "");
      toast.success("PDF padrão de prova salvo.");
      invalidate();
    },
    onError: (err: Error) => setErro("template", err.message),
  });

  const clearTemplateMutation = useMutation({
    mutationFn: () => clearPapelariaProvaEmailTemplate(modelo.id),
    onSuccess: () => {
      setErro("template");
      setTemplatePath("");
      toast.success("PDF padrão de prova removido.");
      invalidate();
    },
    onError: (err: Error) => setErro("template", err.message),
  });

  const padraoMutation = useMutation({
    mutationFn: (p: { face: "frente" | "verso"; padrao: boolean }) =>
      savePapelariaAdminModeloPadrao(modelo.id, p.face, p.padrao),
    onSuccess: (_data, p) => {
      setErro("padrao");
      toast.success(
        p.padrao
          ? `Definido como ${p.face} padrão de ${modelo.produto} · ${modelo.cores}.`
          : `Deixou de ser ${p.face} padrão.`,
      );
      invalidate();
      void qc.invalidateQueries({ queryKey: ["papelaria", "faces"] });
    },
    onError: (err: Error) => setErro("padrao", err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deletePapelariaAdminModelo(modelo.id),
    onSuccess: () => {
      toast.success("Modelo excluído.");
      invalidate();
      onDeleted?.(modelo.id);
    },
    onError: (err: Error) => setErro("excluir", err.message),
  });

  const dirtyNome = nome.trim() !== modelo.nome_exibicao.trim();
  const dirtyPasta = pastaImposicao.trim() !== (modelo.pasta_imposicao ?? "").trim();
  const saving =
    saveNomeMutation.isPending ||
    savePastaMutation.isPending ||
    uploadTemplateMutation.isPending ||
    clearTemplateMutation.isPending;

  const handleDelete = () => {
    const label = modelo.nome_exibicao || modelo.arquivo_modelo;
    if (
      !window.confirm(
        `Excluir o modelo "${label}"?\n\nEle deixará de aparecer na Papelaria. Jobs já gerados não são afetados.`,
      )
    ) {
      return;
    }
    deleteMutation.mutate();
  };

  /** Enter salva, Esc descarta a edição do campo. */
  const inputKeys =
    (dirty: boolean, save: () => void, revert: () => void) => (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && dirty && !saving) {
        e.preventDefault();
        save();
      } else if (e.key === "Escape" && dirty) {
        e.preventDefault();
        revert();
      }
    };

  const templateFileName = templatePath
    ? templatePath.replace(/\\/g, "/").split("/").pop() || templatePath
    : null;

  return (
    <div className="pw-panel pw-scroll">
      <div className="pw-dados-grid">
        {/* Identificação */}
        <PanelCard
          className="pw-dados-grid__wide"
          icon={<Tag className="size-3.5" aria-hidden />}
          title="Identificação"
          description="Como o modelo aparece para quem pede a prova na página Papelaria."
        >
          <dl className="pw-facts">
            <div>
              <dt>Arquivo Corel</dt>
              <dd className="font-mono" title={modelo.arquivo_modelo}>
                {modelo.arquivo_modelo}
              </dd>
            </div>
            <div>
              <dt>Frente / verso</dt>
              <dd>{modelo.frente_versao || "—"}</dd>
            </div>
            <div>
              <dt>Cores</dt>
              <dd>{modelo.cores || "—"}</dd>
            </div>
            <div>
              <dt>ID</dt>
              <dd className="font-mono">#{modelo.id}</dd>
            </div>
          </dl>

          <Field
            className="mt-4"
            label="Nome de exibição"
            htmlFor={`pw-nome-${modelo.id}`}
            hint="Em branco + salvar = volta ao nome automático (produto + frente/verso + cores). Enter salva · Esc desfaz."
          >
            <div className="pw-input-group">
              <input
                id={`pw-nome-${modelo.id}`}
                type="text"
                className="pw-input"
                value={nome}
                maxLength={255}
                placeholder="Nome exibido na página Papelaria"
                onChange={(e) => {
                  setNome(e.target.value);
                  setErro("nome");
                }}
                onKeyDown={inputKeys(dirtyNome, () => saveNomeMutation.mutate(), () => setNome(modelo.nome_exibicao))}
              />
              {dirtyNome ? (
                <button
                  type="button"
                  className="sagra-btn sagra-btn--outline sagra-btn--sm"
                  title="Desfazer alteração"
                  aria-label="Desfazer alteração do nome"
                  onClick={() => setNome(modelo.nome_exibicao)}
                >
                  <RotateCcw className="size-3.5" aria-hidden />
                </button>
              ) : null}
              <button
                type="button"
                className="sagra-btn sagra-btn--save sagra-btn--sm"
                disabled={!dirtyNome || saving}
                onClick={() => saveNomeMutation.mutate()}
              >
                {saveNomeMutation.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <Save className="size-3.5" aria-hidden />
                )}
                Salvar
              </button>
            </div>
          </Field>
          {erros.nome ? <InlineMessage tone="error" className="mt-2">{erros.nome}</InlineMessage> : null}
        </PanelCard>

        {/* Frente e verso — modelo padrão */}
        <PanelCard
          className="pw-dados-grid__wide"
          icon={<Layers className="size-3.5" aria-hidden />}
          title="Modelo padrão"
          description={
            <>
              Vem selecionado ao criar a prova de <strong>{modelo.produto}</strong> · {modelo.cores}. Em produto
              frente e verso, a frente e o verso podem vir de modelos diferentes (modo Prova PDF); o usuário
              troca na hora, se quiser.
            </>
          }
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            {facesDoModelo(modelo.frente_versao).map((face) => {
              const ativo = Boolean(face === "frente" ? modelo.padrao_frente : modelo.padrao_verso);
              const pagina = face === "verso" && facesDoModelo(modelo.frente_versao).length === 2 ? 2 : 1;
              return (
                <label key={face} className="pw-switch-row flex-1">
                  <input
                    type="checkbox"
                    className="pw-switch"
                    checked={ativo}
                    disabled={padraoMutation.isPending}
                    onChange={(e) => padraoMutation.mutate({ face, padrao: e.target.checked })}
                  />
                  <span>
                    <span className="block text-xs font-semibold text-slate-800">
                      {face === "frente" ? "Frente padrão" : "Verso padrão"}
                    </span>
                    <span className="block text-[11px] text-slate-500">
                      Usa a página {pagina} deste modelo. Marcar aqui desmarca o outro padrão do mesmo produto e cores.
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          {erros.padrao ? <InlineMessage tone="error" className="mt-2">{erros.padrao}</InlineMessage> : null}
        </PanelCard>

        {/* Pasta de imposição */}
        <PanelCard
          icon={<FolderOpen className="size-3.5" aria-hidden />}
          title="Pasta do PDF de imposição"
          description="Onde o botão Imposição grava o PDF gerado."
          actions={
            (modelo.pasta_imposicao ?? "").trim() ? (
              <StatusPill tone="ok">Personalizada</StatusPill>
            ) : (
              <StatusPill tone="muted">Pasta Sefoc da OS</StatusPill>
            )
          }
        >
          <Field
            label="Caminho UNC"
            htmlFor={`pw-pasta-${modelo.id}`}
            hint="Caminho absoluto. Em branco = pasta Sefoc da OS."
          >
            <div className="pw-input-group">
              <input
                id={`pw-pasta-${modelo.id}`}
                type="text"
                className="pw-input font-mono"
                value={pastaImposicao}
                maxLength={512}
                placeholder="\\redecamara\DfsData\..."
                onChange={(e) => {
                  setPastaImposicao(e.target.value);
                  setErro("pasta");
                }}
                onKeyDown={inputKeys(
                  dirtyPasta,
                  () => savePastaMutation.mutate(),
                  () => setPastaImposicao(modelo.pasta_imposicao ?? ""),
                )}
              />
              <button
                type="button"
                className="sagra-btn sagra-btn--save sagra-btn--sm"
                disabled={!dirtyPasta || saving}
                onClick={() => savePastaMutation.mutate()}
              >
                {savePastaMutation.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <Save className="size-3.5" aria-hidden />
                )}
                Salvar
              </button>
            </div>
          </Field>
          {erros.pasta ? <InlineMessage tone="error" className="mt-2">{erros.pasta}</InlineMessage> : null}
        </PanelCard>

        {/* PDF padrão de prova (modo e-mail) */}
        <PanelCard
          icon={<FileText className="size-3.5" aria-hidden />}
          title="PDF padrão de prova (modo e-mail)"
          description="Opcional. No modo Prova e-mail, a página 1 do BaseSefoc entra na área BordaF e o carimbo recebe os dados da OS."
          actions={
            templateFileName ? <StatusPill tone="ok">Cadastrado</StatusPill> : <StatusPill tone="muted">Não cadastrado</StatusPill>
          }
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              setErro("template");
              uploadTemplateMutation.mutate(file);
            }}
          />
          <div className="pw-file-row">
            <FileText className="size-4 shrink-0 text-slate-400" aria-hidden />
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-700" title={templatePath || undefined}>
              {templateFileName ?? "Nenhum PDF cadastrado"}
            </span>
            <div className="flex shrink-0 flex-wrap gap-2">
              <button
                type="button"
                className="sagra-btn sagra-btn--outline sagra-btn--sm"
                disabled={saving}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploadTemplateMutation.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <Upload className="size-3.5" aria-hidden />
                )}
                {templateFileName ? "Substituir" : "Enviar PDF"}
              </button>
              {templateFileName ? (
                <button
                  type="button"
                  className="sagra-btn sagra-btn--delete-outline sagra-btn--sm"
                  disabled={saving}
                  onClick={() => {
                    if (!window.confirm("Remover o PDF padrão de prova deste modelo?")) return;
                    setErro("template");
                    clearTemplateMutation.mutate();
                  }}
                >
                  {clearTemplateMutation.isPending ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Trash2 className="size-3.5" aria-hidden />
                  )}
                  Remover
                </button>
              ) : null}
            </div>
          </div>
          {erros.template ? <InlineMessage tone="error" className="mt-2">{erros.template}</InlineMessage> : null}
        </PanelCard>

        {/* Zona de perigo */}
        <PanelCard
          className="pw-dados-grid__wide"
          tone="danger"
          icon={<Trash2 className="size-3.5" aria-hidden />}
          title="Excluir modelo"
          description="O modelo deixa de aparecer na Papelaria. Jobs já gerados não são afetados."
          actions={
            <button
              type="button"
              className="sagra-btn sagra-btn--delete-outline sagra-btn--sm"
              disabled={deleteMutation.isPending || saving}
              onClick={handleDelete}
            >
              {deleteMutation.isPending ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <Trash2 className="size-3.5" aria-hidden />
              )}
              Excluir modelo
            </button>
          }
        >
          {erros.excluir ? <InlineMessage tone="error">{erros.excluir}</InlineMessage> : null}
        </PanelCard>
      </div>
    </div>
  );
}
