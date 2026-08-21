import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@sagra/ui";
import {
  CheckCircle2,
  Eye,
  Loader2,
  Mail,
  Plus,
  Save,
  Send,
  Trash2,
} from "lucide-react";
import { useMemo, useEffect, useState } from "react";

import {
  activateEmailTemplateModel,
  createEmailTemplateModel,
  deleteEmailTemplateModel,
  fetchEmailTemplateModels,
  previewEmailTemplateModel,
  sendTestEmailTemplateModel,
  updateEmailTemplateModel,
} from "@/api/adminSystem";
import type {
  EmailTemplateModelGrupo,
  EmailTemplateModelRecord,
  EmailTemplateModelVariante,
} from "@/features/configuracoes/types";

import {
  ConfigLoadingState,
  ConfigSection,
  ConfigSectionBody,
  ConfigSectionHeader,
  ConfigSidebarGroupLabel,
} from "./ConfigSectionLayout";
import { EmailLivePreviewPanel } from "./EmailLivePreviewPanel";

const GRUPO_LABELS: Record<EmailTemplateModelGrupo, string> = {
  prova_os: "Prova OS",
  prova_sp: "Prova SP",
  problema_tecnico: "Problemas técnicos",
  timbrado_a4_digital: "Timbrado A4 Digital",
};

const VARIANTE_LABELS: Record<EmailTemplateModelVariante, string> = {
  portal: "Com portal / link",
  sem_portal: "Sem portal",
};

const GRUPOS: EmailTemplateModelGrupo[] = [
  "prova_os",
  "prova_sp",
  "problema_tecnico",
  "timbrado_a4_digital",
];

function variantHint(grupo: EmailTemplateModelGrupo, variante: EmailTemplateModelVariante) {
  if (grupo === "problema_tecnico" && variante === "sem_portal") {
    return "Use {TEXTO_AQUI} no ponto onde os problemas técnicos devem aparecer no corpo do e-mail.";
  }
  if (grupo === "timbrado_a4_digital") {
    return "Envio com os 2 DOCX (Cor/PB) da pasta Sefoc — sem portal.";
  }
  if (grupo.startsWith("prova_") && variante === "sem_portal") {
    return "Quando este modelo estiver ativo e «habilitar envio de anexo» estiver ligado, o PDF selecionado da prova será anexado ao e-mail.";
  }
  if (variante === "portal" && grupo.startsWith("prova_")) {
    return "Envio com link do portal de aprovação (sem anexo PDF no e-mail).";
  }
  return "Relatório com link do portal do cliente quando aplicável.";
}

export function EmailTemplateModelsSection() {
  const qc = useQueryClient();
  const modelsQuery = useQuery({
    queryKey: ["admin", "email-template-models"],
    queryFn: () => fetchEmailTemplateModels(),
  });

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [nome, setNome] = useState("");
  const [assunto, setAssunto] = useState("");
  const [html, setHtml] = useState("");
  const [anexarPdf, setAnexarPdf] = useState(false);
  const [previewSubject, setPreviewSubject] = useState("");
  const [previewHtml, setPreviewHtml] = useState("");
  const [testRecipient, setTestRecipient] = useState("");
  const [creatingGrupo, setCreatingGrupo] = useState<EmailTemplateModelGrupo | null>(null);
  const [creatingVariante, setCreatingVariante] =
    useState<EmailTemplateModelVariante>("portal");

  const models = modelsQuery.data?.models ?? [];

  const selected = useMemo(
    () => models.find((m) => m.id === selectedId) ?? null,
    [models, selectedId],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, EmailTemplateModelRecord[]>();
    for (const m of models) {
      const key = m.grupo;
      const list = map.get(key) ?? [];
      list.push(m);
      map.set(key, list);
    }
    return map;
  }, [models]);

  const applyModel = (m: EmailTemplateModelRecord) => {
    setSelectedId(m.id);
    setNome(m.nome);
    setAssunto(m.assunto);
    setHtml(m.html);
    setAnexarPdf(m.anexar_pdf);
    setPreviewSubject("");
    setPreviewHtml("");
  };

  const reportError = (error: unknown) => {
    window.alert(error instanceof Error ? error.message : "Operação falhou.");
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!selectedId) throw new Error("Selecione um modelo.");
      return updateEmailTemplateModel(selectedId, {
        nome,
        assunto,
        html,
        anexar_pdf: anexarPdf,
      });
    },
    onSuccess: (data) => {
      applyModel(data.model);
      void qc.invalidateQueries({ queryKey: ["admin", "email-template-models"] });
      window.alert("Modelo salvo.");
    },
    onError: reportError,
  });

  const createMutation = useMutation({
    mutationFn: () => {
      if (!creatingGrupo) throw new Error("Selecione o grupo.");
      return createEmailTemplateModel({
        grupo: creatingGrupo,
        variante: creatingVariante,
        nome: nome.trim() || `Novo modelo (${VARIANTE_LABELS[creatingVariante]})`,
        assunto,
        html: html.trim() || "<html><body><p>Novo modelo</p></body></html>",
        anexar_pdf: creatingGrupo.startsWith("prova_") && creatingVariante === "sem_portal",
      });
    },
    onSuccess: (data) => {
      setCreatingGrupo(null);
      applyModel(data.model);
      void qc.invalidateQueries({ queryKey: ["admin", "email-template-models"] });
      window.alert("Modelo criado.");
    },
    onError: reportError,
  });

  const activateMutation = useMutation({
    mutationFn: (id: number) => activateEmailTemplateModel(id),
    onSuccess: (data) => {
      applyModel(data.model);
      void qc.invalidateQueries({ queryKey: ["admin", "email-template-models"] });
    },
    onError: reportError,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteEmailTemplateModel(id),
    onSuccess: () => {
      setSelectedId(null);
      void qc.invalidateQueries({ queryKey: ["admin", "email-template-models"] });
      window.alert("Modelo excluído.");
    },
    onError: reportError,
  });

  const previewMutation = useMutation({
    mutationFn: () => {
      if (!selectedId) throw new Error("Selecione um modelo.");
      return previewEmailTemplateModel(selectedId);
    },
    onSuccess: (data) => {
      setPreviewSubject(data.subject);
      setPreviewHtml(data.html);
    },
    onError: reportError,
  });

  const sendTestMutation = useMutation({
    mutationFn: () => {
      if (!selectedId) throw new Error("Selecione um modelo.");
      const to = testRecipient.trim();
      if (!to.includes("@")) throw new Error("Informe um e-mail válido para o teste.");
      return sendTestEmailTemplateModel(selectedId, to);
    },
    onSuccess: (data) => {
      window.alert(`Teste enviado para ${data.to}\nAssunto: ${data.subject}`);
    },
    onError: reportError,
  });

  const isProva = selected?.grupo.startsWith("prova_") ?? false;

  useEffect(() => {
    setPreviewSubject("");
    setPreviewHtml("");
  }, [html, assunto]);

  const previewPanelSubject = previewSubject || assunto;
  const previewPanelHtml = previewHtml || html;

  const handlePreviewHtmlChange = (next: string) => {
    setPreviewHtml("");
    setPreviewSubject("");
    setHtml(next);
  };

  return (
    <ConfigSection variant="email">
      <ConfigSectionHeader
        title="Modelos de envio (prova OS, prova SP e problemas técnicos)"
        description="Configuração central dos e-mails operacionais enviados pelo SAGRA. Apenas um modelo ativo por categoria é usado na prévia e no envio — ao ativar um modelo, os demais da mesma categoria são desativados."
        icon={<Mail className="size-4" aria-hidden />}
      />

      <ConfigSectionBody noPadding className="email-admin-three-col min-h-0 flex-1 p-4">
      {modelsQuery.isLoading ? (
        <ConfigLoadingState className="col-span-full">
          <Loader2 className="size-4 animate-spin" />
          Carregando modelos…
        </ConfigLoadingState>
      ) : (
        <>
        <div className="email-admin-col overflow-hidden rounded border border-slate-200">
          <p className="shrink-0 border-b border-slate-200 bg-slate-50 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Modelos
          </p>
          <div className="papelaria-admin-model-list">
            {GRUPOS.map((grupo) => (
              <div key={grupo}>
                <ConfigSidebarGroupLabel>{GRUPO_LABELS[grupo]}</ConfigSidebarGroupLabel>
                {(grouped.get(grupo) ?? []).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => applyModel(m)}
                    className={cn(
                      "mb-0.5 flex w-full flex-col rounded-md px-2 py-1.5 text-left text-xs",
                      selectedId === m.id
                        ? "bg-secondary-blue/10 text-secondary-blue"
                        : "text-slate-700 hover:bg-slate-50",
                    )}
                  >
                    <span className="font-semibold">{m.nome}</span>
                    <span className="text-[10px] text-slate-500">
                      {VARIANTE_LABELS[m.variante]}
                      {m.ativo ? " · ativo" : ""}
                      {m.anexar_pdf ? " · anexo" : ""}
                    </span>
                  </button>
                ))}
                <div className="flex flex-wrap gap-1 px-1 pb-2">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded border border-dashed border-slate-300 px-2 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50"
                    onClick={() => {
                      setCreatingGrupo(grupo);
                      setCreatingVariante("portal");
                      setNome("");
                      setAssunto("");
                      setHtml("");
                      setAnexarPdf(false);
                      setSelectedId(null);
                    }}
                  >
                    <Plus className="size-3" />
                    Novo (portal)
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded border border-dashed border-slate-300 px-2 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50"
                    onClick={() => {
                      setCreatingGrupo(grupo);
                      setCreatingVariante("sem_portal");
                      setNome("");
                      setAssunto("");
                      setHtml(
                        grupo === "problema_tecnico"
                          ? "<html><body><p>Prezado(a),</p>{TEXTO_AQUI}</body></html>"
                          : "",
                      );
                      setAnexarPdf(grupo.startsWith("prova_"));
                      setSelectedId(null);
                    }}
                  >
                    <Plus className="size-3" />
                    Novo (sem portal)
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {creatingGrupo || selected ? (
          <>
            <div className="email-admin-col email-admin-editor-scroll space-y-3 rounded border border-slate-200 p-3">
              {creatingGrupo ? (
                <>
                  <p className="text-xs font-semibold text-slate-700">
                    Novo modelo — {GRUPO_LABELS[creatingGrupo]} /{" "}
                    {VARIANTE_LABELS[creatingVariante]}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {variantHint(creatingGrupo, creatingVariante)}
                  </p>
                  <label className="block text-xs">
                    Nome
                    <input
                      value={nome}
                      onChange={(e) => setNome(e.target.value)}
                      className="mt-1 h-9 w-full rounded-lg border border-slate-300 px-2 text-sm"
                    />
                  </label>
                  <label className="block text-xs">
                    Assunto
                    <input
                      value={assunto}
                      onChange={(e) => setAssunto(e.target.value)}
                      className="mt-1 h-9 w-full rounded-lg border border-slate-300 px-2 font-mono text-sm"
                    />
                  </label>
                  <label className="block text-xs">
                    Corpo HTML
                    <textarea
                      value={html}
                      onChange={(e) => setHtml(e.target.value)}
                      rows={8}
                      spellCheck={false}
                      className="mt-1 w-full resize-y rounded-lg border border-slate-300 px-2 py-1 font-mono text-xs"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={createMutation.isPending}
                    onClick={() => void createMutation.mutate()}
                    className="inline-flex h-9 items-center gap-1 rounded-lg bg-secondary-blue px-3 text-xs font-semibold text-white"
                  >
                    {createMutation.isPending ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Plus className="size-3.5" />
                    )}
                    Criar modelo
                  </button>
                </>
              ) : selected ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-bold text-slate-800">{selected.nome}</h3>
                      <p className="text-[11px] text-slate-500">
                        {GRUPO_LABELS[selected.grupo]} · {VARIANTE_LABELS[selected.variante]}
                        {selected.ativo ? (
                          <span className="ml-2 inline-flex items-center gap-0.5 text-emerald-700">
                            <CheckCircle2 className="size-3" />
                            Ativo
                          </span>
                        ) : null}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {!selected.ativo ? (
                        <button
                          type="button"
                          onClick={() => activateMutation.mutate(selected.id)}
                          disabled={activateMutation.isPending}
                          className="h-8 rounded-lg border border-emerald-300 bg-emerald-50 px-2 text-xs font-semibold text-emerald-800"
                        >
                          Ativar
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => {
                          if (!window.confirm("Excluir este modelo?")) return;
                          deleteMutation.mutate(selected.id);
                        }}
                        disabled={deleteMutation.isPending || selected.ativo}
                        className="inline-flex h-8 items-center gap-1 rounded-lg border border-red-200 px-2 text-xs text-red-700 disabled:opacity-40"
                      >
                        <Trash2 className="size-3" />
                        Excluir
                      </button>
                    </div>
                  </div>

                  <p className="rounded-md bg-slate-50 px-2 py-1.5 text-[11px] text-slate-600">
                    {variantHint(selected.grupo, selected.variante)}
                  </p>

                  <label className="block text-xs">
                    Nome
                    <input
                      value={nome}
                      onChange={(e) => setNome(e.target.value)}
                      className="mt-1 h-9 w-full rounded-lg border border-slate-300 px-2 text-sm"
                    />
                  </label>
                  <label className="block text-xs">
                    Assunto
                    <input
                      value={assunto}
                      onChange={(e) => setAssunto(e.target.value)}
                      className="mt-1 h-9 w-full rounded-lg border border-slate-300 px-2 font-mono text-sm"
                    />
                  </label>
                  {isProva ? (
                    <label className="flex items-center gap-2 text-xs text-slate-700">
                      <input
                        type="checkbox"
                        checked={anexarPdf}
                        onChange={(e) => setAnexarPdf(e.target.checked)}
                        disabled={selected.variante === "portal"}
                      />
                      Habilitar envio de anexo PDF
                    </label>
                  ) : null}
                  <label className="block text-xs">
                    Corpo HTML
                    <textarea
                      value={html}
                      onChange={(e) => setHtml(e.target.value)}
                      rows={10}
                      spellCheck={false}
                      className="mt-1 w-full resize-y rounded-lg border border-slate-300 px-2 py-1 font-mono text-xs"
                    />
                  </label>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={saveMutation.isPending}
                      onClick={() => void saveMutation.mutate()}
                      className="inline-flex h-8 items-center gap-1 rounded-lg bg-secondary-blue px-3 text-xs font-semibold text-white"
                    >
                      {saveMutation.isPending ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Save className="size-3.5" />
                      )}
                      Salvar
                    </button>
                    <button
                      type="button"
                      onClick={() => void previewMutation.mutate()}
                      className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-300 px-3 text-xs"
                    >
                      <Eye className="size-3.5" />
                      Pré-visualizar (variáveis)
                    </button>
                  </div>

                  <div className="rounded-lg border border-dashed border-slate-200 p-2">
                    <p className="text-[10px] font-semibold text-slate-500">Envio de teste</p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      <input
                        type="email"
                        value={testRecipient}
                        onChange={(e) => setTestRecipient(e.target.value)}
                        placeholder="destinatario@exemplo.gov.br"
                        className="h-8 min-w-[200px] flex-1 rounded-lg border border-slate-300 px-2 text-xs"
                      />
                      <button
                        type="button"
                        disabled={sendTestMutation.isPending}
                        onClick={() => {
                          if (!window.confirm("Enviar e-mail de teste real?")) return;
                          void sendTestMutation.mutate();
                        }}
                        className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-300 px-2 text-xs"
                      >
                        <Send className="size-3" />
                        Testar
                      </button>
                    </div>
                  </div>
                </>
              ) : null}
            </div>

            <EmailLivePreviewPanel
              subject={previewPanelSubject}
              html={previewPanelHtml}
              editable
              onHtmlChange={handlePreviewHtmlChange}
              emptyMessage={
                creatingGrupo
                  ? "Preencha o HTML do novo modelo para ver a prévia."
                  : "Edite o corpo HTML para ver a prévia em tempo real."
              }
            />
          </>
        ) : (
          <div className="email-admin-col-span flex items-center justify-center rounded border border-dashed border-slate-200 bg-slate-50/50 p-6 text-xs text-slate-500 lg:col-span-2">
            Selecione um modelo na lista ou crie um novo.
          </div>
        )}
        </>
      )}
      </ConfigSectionBody>
    </ConfigSection>
  );
}
