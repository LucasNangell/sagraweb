import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "@sagra/ui";
import { Loader2, Save, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";

import {
  clearPapelariaProvaEmailTemplate,
  deletePapelariaAdminModelo,
  savePapelariaAdminNomeExibicao,
  savePapelariaAdminPastaImposicao,
  uploadPapelariaProvaEmailTemplate,
} from "@/api/adminSystem";
import type { PapelariaAdminModelRecord } from "@/features/configuracoes/types";

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
  const [pastaImposicao, setPastaImposicao] = useState(
    modelo.pasta_imposicao ?? "",
  );
  const [templatePath, setTemplatePath] = useState(
    modelo.prova_email_template_pdf ?? "",
  );
  const [localMsg, setLocalMsg] = useState<string | null>(null);

  const saveNomeMutation = useMutation({
    mutationFn: () => {
      const trimmed = nome.trim();
      return savePapelariaAdminNomeExibicao(modelo.id, trimmed || null);
    },
    onSuccess: (data) => {
      setLocalMsg("Nome salvo.");
      setNome(data.nome_exibicao);
      void qc.invalidateQueries({ queryKey: ["admin", "papelaria-modelos"] });
    },
    onError: (err: Error) => setLocalMsg(err.message),
  });

  const savePastaMutation = useMutation({
    mutationFn: () => {
      const trimmed = pastaImposicao.trim();
      return savePapelariaAdminPastaImposicao(modelo.id, trimmed || null);
    },
    onSuccess: (data) => {
      setLocalMsg("Pasta de imposição salva.");
      setPastaImposicao(data.pasta_imposicao ?? "");
      void qc.invalidateQueries({ queryKey: ["admin", "papelaria-modelos"] });
    },
    onError: (err: Error) => setLocalMsg(err.message),
  });

  const uploadTemplateMutation = useMutation({
    mutationFn: (file: File) => uploadPapelariaProvaEmailTemplate(modelo.id, file),
    onSuccess: (data) => {
      setLocalMsg("PDF padrão de prova salvo.");
      setTemplatePath(data.prova_email_template_pdf ?? "");
      void qc.invalidateQueries({ queryKey: ["admin", "papelaria-modelos"] });
    },
    onError: (err: Error) => setLocalMsg(err.message),
  });

  const clearTemplateMutation = useMutation({
    mutationFn: () => clearPapelariaProvaEmailTemplate(modelo.id),
    onSuccess: () => {
      setLocalMsg("PDF padrão de prova removido.");
      setTemplatePath("");
      void qc.invalidateQueries({ queryKey: ["admin", "papelaria-modelos"] });
    },
    onError: (err: Error) => setLocalMsg(err.message),
  });

  const dirtyNome = nome.trim() !== modelo.nome_exibicao.trim();
  const dirtyPasta =
    pastaImposicao.trim() !== (modelo.pasta_imposicao ?? "").trim();
  const saving =
    saveNomeMutation.isPending ||
    savePastaMutation.isPending ||
    uploadTemplateMutation.isPending ||
    clearTemplateMutation.isPending;

  const deleteMutation = useMutation({
    mutationFn: () => deletePapelariaAdminModelo(modelo.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "papelaria-modelos"] });
      onDeleted?.(modelo.id);
    },
    onError: (err: Error) => setLocalMsg(err.message),
  });

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

  const msgIsError =
    saveNomeMutation.isError ||
    savePastaMutation.isError ||
    uploadTemplateMutation.isError ||
    clearTemplateMutation.isError ||
    deleteMutation.isError;

  const templateFileName = templatePath
    ? templatePath.replace(/\\/g, "/").split("/").pop() || templatePath
    : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Arquivo Corel
          </p>
          <p className="mt-1 font-mono text-[11px] text-slate-700">{modelo.arquivo_modelo}</p>
        </div>
        <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Variação
          </p>
          <p className="mt-1 text-slate-700">
            {modelo.frente_versao || "—"}
            {modelo.cores ? ` · ${modelo.cores}` : ""}
          </p>
        </div>
      </div>

      <label className="flex max-w-xl flex-col gap-1 text-xs text-slate-600">
        Nome de exibição
        <input
          type="text"
          className="rounded border border-slate-300 px-2 py-1.5 text-xs text-slate-800"
          value={nome}
          maxLength={255}
          placeholder="Nome exibido na página Papelaria"
          onChange={(e) => {
            setNome(e.target.value);
            setLocalMsg(null);
          }}
        />
        <span className="text-[10px] text-slate-500">
          Deixe em branco e salve para voltar ao nome automático (produto + frente/verso + cores).
        </span>
      </label>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={cn(
            "inline-flex items-center justify-center gap-1 rounded px-3 py-1.5 text-xs font-semibold",
            dirtyNome
              ? "bg-secondary-blue text-white hover:bg-secondary-blue/90"
              : "border border-slate-300 text-slate-500",
          )}
          disabled={!dirtyNome || saving}
          onClick={() => saveNomeMutation.mutate()}
        >
          {saveNomeMutation.isPending ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <Save className="size-3.5" aria-hidden />
          )}
          Salvar nome
        </button>
        <button
          type="button"
          className="inline-flex items-center justify-center gap-1 rounded border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
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
      </div>

      <label className="flex max-w-xl flex-col gap-1 text-xs text-slate-600">
        Pasta do PDF de Imposição
        <input
          type="text"
          className="rounded border border-slate-300 px-2 py-1.5 font-mono text-xs text-slate-800"
          value={pastaImposicao}
          maxLength={512}
          placeholder="\\redecamara\DfsData\..."
          onChange={(e) => {
            setPastaImposicao(e.target.value);
            setLocalMsg(null);
          }}
        />
        <span className="text-[10px] text-slate-500">
          Caminho absoluto UNC onde o botão Imposição grava o PDF. Em branco = pasta Sefoc da OS.
        </span>
      </label>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={cn(
            "inline-flex items-center justify-center gap-1 rounded px-3 py-1.5 text-xs font-semibold",
            dirtyPasta
              ? "bg-secondary-blue text-white hover:bg-secondary-blue/90"
              : "border border-slate-300 text-slate-500",
          )}
          disabled={!dirtyPasta || saving}
          onClick={() => savePastaMutation.mutate()}
        >
          {savePastaMutation.isPending ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <Save className="size-3.5" aria-hidden />
          )}
          Salvar pasta
        </button>
      </div>

      <div className="max-w-xl rounded border border-slate-200 bg-slate-50 px-3 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          PDF padrão de prova (modo e-mail)
        </p>
        <p className="mt-1 text-[10px] text-slate-500">
          Opcional. Quando cadastrado e o modo Prova e-mail estiver ativo, a prova
          usa este PDF: a página 1 do BaseSefoc entra na área BordaF e o carimbo
          recebe os dados da OS.
        </p>
        <p className="mt-2 font-mono text-[11px] text-slate-700">
          {templateFileName ? `Atual: ${templateFileName}` : "Nenhum PDF cadastrado."}
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            setLocalMsg(null);
            uploadTemplateMutation.mutate(file);
          }}
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            className="inline-flex items-center justify-center gap-1 rounded bg-secondary-blue px-3 py-1.5 text-xs font-semibold text-white hover:bg-secondary-blue/90 disabled:opacity-60"
            disabled={saving}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploadTemplateMutation.isPending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Upload className="size-3.5" aria-hidden />
            )}
            {templateFileName ? "Substituir PDF" : "Enviar PDF"}
          </button>
          {templateFileName ? (
            <button
              type="button"
              className="inline-flex items-center justify-center gap-1 rounded border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
              disabled={saving}
              onClick={() => {
                if (
                  !window.confirm(
                    "Remover o PDF padrão de prova deste modelo?",
                  )
                ) {
                  return;
                }
                setLocalMsg(null);
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

      {localMsg ? (
        <p
          className={cn(
            "text-xs",
            msgIsError ? "text-red-600" : "text-emerald-700",
          )}
        >
          {localMsg}
        </p>
      ) : null}
    </div>
  );
}
