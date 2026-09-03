import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@sagra/ui";
import { Eye, Loader2, Mail, Plus, RotateCcw, Save, Send, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  deleteEmailTemplatePreset,
  fetchEmailTemplateModels,
  fetchEmailTemplatesConfig,
  previewEmailTemplate,
  resetEmailTemplate,
  saveEmailSendMailboxes,
  saveGravacaoEmailNotifications,
  saveEmailTemplate,
  sendTestEmailTemplate,
  uploadEmailTemplatePreset,
} from "@/api/adminSystem";
import { EmailDispatchModePanel } from "./EmailDispatchModePanel";
import type {
  EmailTemplateModelGrupo,
  EmailTemplateModelRecord,
  EmailTemplateModelVariante,
  EmailTemplateRecord,
} from "@/features/configuracoes/types";

import {
  ConfigErrorState,
  ConfigLoadingState,
  ConfigSection,
  ConfigSectionBody,
  ConfigSectionHeader,
  ConfigSidebarGroupLabel,
  ConfigSubsection,
} from "./ConfigSectionLayout";
import { EmailLivePreviewPanel } from "./EmailLivePreviewPanel";
import {
  OperationalEmailEditorPanel,
  type OperationalEditorPreview,
} from "./OperationalEmailEditorPanel";
import { useEmailTemplateLivePreview } from "../hooks/useEmailTemplateLivePreview";

/** Modelos operacionais legados — editados via tabEmailTemplateModel na lista unificada. */
const OPERATIONAL_LEGACY_TEMPLATE_IDS = new Set([
  "proof_os",
  "proof_sp",
  "pt_report_wrapper",
  "pt_send_subject",
]);

const SYSTEM_SIDEBAR_ORDER = [
  "activation",
  "password_reset",
  "cliente_activation",
  "os_arquivos_link",
  "gravacao_encaminhada",
  "gravacao_iniciada",
  "gravacao_concluida",
] as const;

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

const OPERATIONAL_GRUPOS: EmailTemplateModelGrupo[] = [
  "prova_os",
  "prova_sp",
  "problema_tecnico",
  "timbrado_a4_digital",
];

type EmailListSelection =
  | { kind: "system"; id: string }
  | { kind: "operational"; id: number }
  | { kind: "operational-create"; grupo: EmailTemplateModelGrupo; variante: EmailTemplateModelVariante };

const MAILBOX_OPTIONS = [
  { value: "sepim.deapa@camara.leg.br", label: "sepim.deapa@camara.leg.br" },
  { value: "papelaria.deapa@camara.leg.br", label: "papelaria.deapa@camara.leg.br" },
];

function variablesHint(vars: string[]) {
  if (!vars.length) return null;
  return vars.map((v) => `{{${v}}}`).join("  ");
}

function parseRecipientList(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\s,;]+/)
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

export function EmailTemplatesSection() {
  const qc = useQueryClient();
  const configQuery = useQuery({
    queryKey: ["admin", "email-templates"],
    queryFn: fetchEmailTemplatesConfig,
  });
  const modelsQuery = useQuery({
    queryKey: ["admin", "email-template-models"],
    queryFn: () => fetchEmailTemplateModels(),
  });

  const [listSelection, setListSelection] = useState<EmailListSelection | null>(null);
  const [creatingOperational, setCreatingOperational] = useState<{
    grupo: EmailTemplateModelGrupo;
    variante: EmailTemplateModelVariante;
  } | null>(null);
  const [operationalPreview, setOperationalPreview] = useState<OperationalEditorPreview>({
    subject: "",
    html: "",
    editable: true,
    loading: false,
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [html, setHtml] = useState("");
  const [previewSubject, setPreviewSubject] = useState("");
  const [previewHtml, setPreviewHtml] = useState("");
  const [osLt, setOsLt] = useState(MAILBOX_OPTIONS[0].value);
  const [osGte, setOsGte] = useState(MAILBOX_OPTIONS[1].value);
  const [activationBox, setActivationBox] = useState("");
  const [forwardedEnabled, setForwardedEnabled] = useState(true);
  const [forwardedRecipientMode, setForwardedRecipientMode] =
    useState<"usuario" | "personalizado">("usuario");
  const [forwardedRecipients, setForwardedRecipients] = useState("");
  const [startedEnabled, setStartedEnabled] = useState(true);
  const [startedRecipientMode, setStartedRecipientMode] =
    useState<"usuario" | "personalizado">("usuario");
  const [startedRecipients, setStartedRecipients] = useState("");
  const [completedEnabled, setCompletedEnabled] = useState(true);
  const [completedRecipientMode, setCompletedRecipientMode] =
    useState<"usuario" | "personalizado">("usuario");
  const [completedRecipients, setCompletedRecipients] = useState("");
  const [contentMode, setContentMode] = useState<"preset" | "custom">("custom");
  const [presetId, setPresetId] = useState("");
  const [uploadLabel, setUploadLabel] = useState("");
  const [selectedUploadFile, setSelectedUploadFile] = useState<File | null>(null);
  const [testRecipient, setTestRecipient] = useState("");
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const operationalHtmlApiRef = useRef<{ setHtml: (html: string) => void } | null>(null);

  const templates = (configQuery.data?.templates ?? []).filter(
    (tpl) => !OPERATIONAL_LEGACY_TEMPLATE_IDS.has(tpl.id),
  );

  const operationalModels = modelsQuery.data?.models ?? [];

  const operationalGrouped = useMemo(() => {
    const map = new Map<string, EmailTemplateModelRecord[]>();
    for (const m of operationalModels) {
      const list = map.get(m.grupo) ?? [];
      list.push(m);
      map.set(m.grupo, list);
    }
    return map;
  }, [operationalModels]);

  const systemTemplatesOrdered = useMemo(() => {
    const byId = new Map(templates.map((t) => [t.id, t]));
    const ordered: EmailTemplateRecord[] = [];
    for (const id of SYSTEM_SIDEBAR_ORDER) {
      const tpl = byId.get(id);
      if (tpl) ordered.push(tpl);
    }
    for (const tpl of templates) {
      if (!SYSTEM_SIDEBAR_ORDER.includes(tpl.id as (typeof SYSTEM_SIDEBAR_ORDER)[number])) {
        ordered.push(tpl);
      }
    }
    return ordered;
  }, [templates]);

  const selected = useMemo(
    () => templates.find((t) => t.id === selectedId) ?? null,
    [templates, selectedId],
  );

  const applyTemplate = useCallback((tpl: EmailTemplateRecord) => {
    setSubject(tpl.subject);
    setHtml(tpl.html);
    const mode: "preset" | "custom" =
      tpl.content_mode === "preset" ? "preset" : "custom";
    setContentMode(mode);
    const presets = tpl.available_presets ?? [];
    setPresetId(
      tpl.preset_id?.trim() ||
        presets[0]?.id ||
        "",
    );
  }, []);

  const syncedSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    if (!templates.length) return;
    if (!listSelection) {
      const first = systemTemplatesOrdered[0] ?? templates[0];
      setListSelection({ kind: "system", id: first.id });
      setSelectedId(first.id);
      applyTemplate(first);
      syncedSignatureRef.current = `${first.id}:${first.updated_at ?? ""}:${first.use_custom}`;
    }
  }, [templates, listSelection, applyTemplate, systemTemplatesOrdered]);

  useEffect(() => {
    if (!templates.length || listSelection?.kind !== "system") return;
    const tpl = templates.find((t) => t.id === listSelection.id);
    if (!tpl) return;
    const signature = `${tpl.id}:${tpl.updated_at ?? ""}:${tpl.use_custom}:${tpl.content_mode ?? ""}:${tpl.preset_id ?? ""}:${tpl.subject.length}:${tpl.html.length}`;
    if (syncedSignatureRef.current === signature) return;
    syncedSignatureRef.current = signature;
    applyTemplate(tpl);
  }, [templates, listSelection, applyTemplate]);

  useEffect(() => {
    if (configQuery.data?.send_mailboxes) {
      setOsLt(configQuery.data.send_mailboxes.os_lt_5000);
      setOsGte(configQuery.data.send_mailboxes.os_gte_5000);
      setActivationBox(configQuery.data.send_mailboxes.activation ?? "");
    }
  }, [configQuery.data?.send_mailboxes]);

  useEffect(() => {
    const settings = configQuery.data?.gravacao_notifications;
    if (!settings) return;
    setForwardedEnabled(settings.encaminhada.enabled !== false);
    setForwardedRecipientMode(settings.encaminhada.mode);
    setForwardedRecipients(settings.encaminhada.recipients.join("\n"));
    setStartedEnabled(settings.iniciada.enabled !== false);
    setStartedRecipientMode(settings.iniciada.mode);
    setStartedRecipients(settings.iniciada.recipients.join("\n"));
    setCompletedEnabled(settings.concluida.enabled !== false);
    setCompletedRecipientMode(settings.concluida.mode);
    setCompletedRecipients(settings.concluida.recipients.join("\n"));
  }, [configQuery.data?.gravacao_notifications]);

  const selectSystemTemplate = (tpl: EmailTemplateRecord) => {
    setCreatingOperational(null);
    setListSelection({ kind: "system", id: tpl.id });
    setSelectedId(tpl.id);
    syncedSignatureRef.current = null;
    applyTemplate(tpl);
    setPreviewSubject("");
    setPreviewHtml("");
  };

  const selectOperationalModel = (m: EmailTemplateModelRecord) => {
    setCreatingOperational(null);
    setListSelection({ kind: "operational", id: m.id });
    setSelectedId(null);
    setPreviewSubject("");
    setPreviewHtml("");
  };

  const startOperationalCreate = (
    grupo: EmailTemplateModelGrupo,
    variante: EmailTemplateModelVariante,
  ) => {
    setListSelection({ kind: "operational-create", grupo, variante });
    setCreatingOperational({ grupo, variante });
    setSelectedId(null);
  };

  const isSystemSelection = listSelection?.kind === "system";
  const isOperationalSelection =
    listSelection?.kind === "operational" || listSelection?.kind === "operational-create";

  const listSelectionActive = (sel: EmailListSelection) => {
    if (!listSelection) return false;
    if (listSelection.kind !== sel.kind) return false;
    if (sel.kind === "system" && listSelection.kind === "system") return listSelection.id === sel.id;
    if (sel.kind === "operational" && listSelection.kind === "operational") {
      return listSelection.id === sel.id;
    }
    if (sel.kind === "operational-create" && listSelection.kind === "operational-create") {
      return listSelection.grupo === sel.grupo && listSelection.variante === sel.variante;
    }
    return false;
  };

  const handleOperationalPreviewChange = useCallback((preview: OperationalEditorPreview) => {
    setOperationalPreview(preview);
  }, []);

  const handleOperationalHtmlEditorReady = useCallback(
    (api: { setHtml: (html: string) => void }) => {
      operationalHtmlApiRef.current = api;
    },
    [],
  );

  const handleOperationalPreviewHtmlChange = useCallback((next: string) => {
    operationalHtmlApiRef.current?.setHtml(next);
    setOperationalPreview((prev) => ({ ...prev, html: next }));
  }, []);

  const reportError = (error: unknown) => {
    window.alert(error instanceof Error ? error.message : "Operação falhou.");
  };

  const saveTemplateMutation = useMutation({
    mutationFn: () => {
      if (!selectedId) throw new Error("Selecione um modelo.");
      if (contentMode === "preset" && !presetId.trim()) {
        throw new Error("Selecione um modelo padrão na lista.");
      }
      return saveEmailTemplate(selectedId, {
        subject,
        html: contentMode === "custom" ? html : "",
        use_custom: true,
        content_mode: contentMode,
        preset_id: contentMode === "preset" ? presetId : "",
      });
    },
    onSuccess: (data) => {
      syncedSignatureRef.current = null;
      applyTemplate(data.template);
      void qc.invalidateQueries({ queryKey: ["admin", "email-templates"] });
      window.alert("Modelo de e-mail salvo.");
    },
    onError: reportError,
  });

  const resetMutation = useMutation({
    mutationFn: () => {
      if (!selectedId) throw new Error("Selecione um modelo.");
      return resetEmailTemplate(selectedId);
    },
    onSuccess: (data) => {
      syncedSignatureRef.current = null;
      void qc.invalidateQueries({ queryKey: ["admin", "email-templates"] });
      applyTemplate(data.template);
      window.alert("Modelo restaurado para o padrão do sistema.");
    },
    onError: reportError,
  });

  const previewMutation = useMutation({
    mutationFn: () => {
      if (!selectedId) throw new Error("Selecione um modelo.");
      return previewEmailTemplate(selectedId, {
        subject,
        html: contentMode === "custom" ? html : "",
        use_custom: true,
        content_mode: contentMode,
        preset_id: contentMode === "preset" ? presetId : "",
      });
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
      if (!to || !to.includes("@")) {
        throw new Error("Informe o e-mail que receberá o teste.");
      }
      return sendTestEmailTemplate(selectedId, {
        to,
        subject,
        html: contentMode === "custom" ? html : "",
        use_custom: true,
        content_mode: contentMode,
        preset_id: contentMode === "preset" ? presetId : "",
      });
    },
    onSuccess: (data) => {
      const fromLabel = data.from_mailbox
        ? data.from_mailbox
        : "conta autenticada no Exchange (.env)";
      window.alert(
        `E-mail de teste enviado para ${data.to}.\n\nAssunto: ${data.subject}\nRemetente: ${fromLabel}`,
      );
    },
    onError: reportError,
  });

  const uploadPresetMutation = useMutation({
    mutationFn: async () => {
      if (!selectedId) throw new Error("Selecione um modelo.");
      if (!selectedUploadFile) {
        throw new Error("Escolha um arquivo .html ou .htm antes de cadastrar.");
      }
      return uploadEmailTemplatePreset(selectedId, selectedUploadFile, {
        label: uploadLabel,
        subject,
        apply: true,
      });
    },
    onSuccess: (data) => {
      syncedSignatureRef.current = null;
      if (data.template) {
        applyTemplate(data.template);
      } else if (data.preset?.id) {
        setPresetId(data.preset.id);
        setContentMode("preset");
      }
      setUploadLabel("");
      setSelectedUploadFile(null);
      if (uploadInputRef.current) {
        uploadInputRef.current.value = "";
      }
      void qc.invalidateQueries({ queryKey: ["admin", "email-templates"] });
      window.alert("Arquivo cadastrado e aplicado a este modelo.");
    },
    onError: reportError,
  });

  const onUploadFilePicked = (file: File | undefined) => {
    if (!file) return;
    setSelectedUploadFile(file);
    if (!uploadLabel.trim()) {
      setUploadLabel(file.name);
    }
  };

  const deletePresetMutation = useMutation({
    mutationFn: () => {
      if (!selectedId || !presetId.startsWith("upload_")) {
        throw new Error("Selecione um modelo cadastrado por upload.");
      }
      return deleteEmailTemplatePreset(selectedId, presetId);
    },
    onSuccess: (data) => {
      syncedSignatureRef.current = null;
      applyTemplate(data.template);
      void qc.invalidateQueries({ queryKey: ["admin", "email-templates"] });
      window.alert("Modelo cadastrado removido.");
    },
    onError: reportError,
  });

  const saveMailboxesMutation = useMutation({
    mutationFn: () =>
      saveEmailSendMailboxes({
        os_lt_5000: osLt,
        os_gte_5000: osGte,
        activation: activationBox,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "email-templates"] });
      window.alert("Contas de envio salvas.");
    },
    onError: reportError,
  });

  const saveGravacaoNotificationsMutation = useMutation({
    mutationFn: () =>
      saveGravacaoEmailNotifications({
        encaminhada: {
          enabled: forwardedEnabled,
          mode: forwardedRecipientMode,
          recipients: parseRecipientList(forwardedRecipients),
        },
        iniciada: {
          enabled: startedEnabled,
          mode: startedRecipientMode,
          recipients: parseRecipientList(startedRecipients),
        },
        concluida: {
          enabled: completedEnabled,
          mode: completedRecipientMode,
          recipients: parseRecipientList(completedRecipients),
        },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "email-templates"] });
      window.alert("Notificações de gravação salvas.");
    },
    onError: reportError,
  });

  const presetOptions = selected?.available_presets ?? [];
  const testFromMailbox = useMemo(() => {
    if (!selected?.mailbox_key) {
      return osLt || "conta autenticada no Exchange (.env)";
    }
    if (selected.mailbox_key === "activation") {
      return activationBox || "conta autenticada no Exchange (.env)";
    }
    if (selected.mailbox_key === "os_gte_5000") {
      return osGte;
    }
    if (selected.mailbox_key === "os_lt_5000") {
      return osLt;
    }
    if (selected.mailbox_key === "by_os") {
      return osLt;
    }
    return osLt;
  }, [selected?.mailbox_key, osLt, osGte, activationBox]);
  const showHtmlEditor =
    selected && contentMode === "custom"
      ? selected.html_variables.length > 0 || html.trim().length > 0
      : false;
  const showSubject = selected ? selected.subject_variables.length > 0 || subject.trim().length > 0 : false;

  const [previewFocused, setPreviewFocused] = useState(false);

  const { liveSubject, liveHtml, loading: livePreviewLoading } = useEmailTemplateLivePreview({
    templateId: isSystemSelection ? selectedId : null,
    subject,
    html,
    contentMode,
    presetId,
    enabled: Boolean(
      isSystemSelection &&
        selectedId &&
        selected &&
        !configQuery.isPending &&
        !configQuery.isError,
    ),
    paused: previewFocused,
  });

  const displayPreviewSubject = isOperationalSelection
    ? operationalPreview.subject
    : previewSubject || liveSubject || subject;
  const displayPreviewHtml = isOperationalSelection
    ? operationalPreview.html
    : previewHtml || liveHtml || (contentMode === "custom" ? html : "");
  const previewEditable = isOperationalSelection
    ? operationalPreview.editable
    : contentMode === "custom" || Boolean((previewHtml || liveHtml || html).trim());
  const previewLoading = isOperationalSelection ? operationalPreview.loading : livePreviewLoading;

  const handlePreviewHtmlChange = useCallback(
    (next: string) => {
      setPreviewSubject("");
      setPreviewHtml("");
      setHtml(next);
      if (contentMode !== "custom") {
        setContentMode("custom");
      }
    },
    [contentMode],
  );

  return (
    <ConfigSection variant="email">
      <ConfigSectionHeader
        title="E-mails do sistema"
        description={
          <>
            Ativação de cadastro, recuperação de senha, provas OS/SP, problemas técnicos e contas
            Exchange. Selecione um modelo na lista unificada abaixo. Variáveis:{" "}
            {(configQuery.data?.variable_hints ?? [])
              .map((v) => `{{${v}}}`)
              .join(", ")}
          </>
        }
        icon={<Mail className="size-4" aria-hidden />}
      />

      <ConfigSectionBody className="space-y-4">
      <EmailDispatchModePanel />

      <ConfigSubsection title="Contas de envio (Exchange)" tone="muted">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="block text-xs text-slate-600">
            OS &lt; 5000 (SEPIM)
            <select
              value={osLt}
              onChange={(e) => setOsLt(e.target.value)}
              className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm"
            >
              {MAILBOX_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-slate-600">
            OS ≥ 5000 (Papelaria)
            <select
              value={osGte}
              onChange={(e) => setOsGte(e.target.value)}
              className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm"
            >
              {MAILBOX_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-slate-600 sm:col-span-2 lg:col-span-1">
            Ativação de cadastro (opcional)
            <select
              value={activationBox || ""}
              onChange={(e) => setActivationBox(e.target.value)}
              className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm"
            >
              <option value="">Conta autenticada no .env (sem &quot;enviar como&quot;)</option>
              {MAILBOX_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          type="button"
          disabled={saveMailboxesMutation.isPending}
          onClick={() => void saveMailboxesMutation.mutate()}
          className="mt-3 inline-flex h-8 items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          {saveMailboxesMutation.isPending ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Save className="size-3" />
          )}
          Salvar contas
        </button>
      </ConfigSubsection>

      <ConfigSubsection title="Notificações da Gravação Externa" tone="muted">
        <p className="mb-3 text-xs text-slate-600">
          Cada evento usa o mesmo remetente da ativação/recuperação de senha. Encaminhada
          notifica o fornecedor; iniciada e concluída notificam o lançador — ou use
          destinatários personalizados.
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          {[
            {
              key: "encaminhada",
              label: "OS encaminhada para Gravação Externa",
              usuarioLabel: "E-mail cadastrado do fornecedor",
              enabled: forwardedEnabled,
              setEnabled: setForwardedEnabled,
              mode: forwardedRecipientMode,
              setMode: setForwardedRecipientMode,
              recipients: forwardedRecipients,
              setRecipients: setForwardedRecipients,
            },
            {
              key: "iniciada",
              label: "Gravação iniciada",
              usuarioLabel: "E-mail cadastrado do usuário lançador",
              enabled: startedEnabled,
              setEnabled: setStartedEnabled,
              mode: startedRecipientMode,
              setMode: setStartedRecipientMode,
              recipients: startedRecipients,
              setRecipients: setStartedRecipients,
            },
            {
              key: "concluida",
              label: "Gravação concluída",
              usuarioLabel: "E-mail cadastrado do usuário lançador",
              enabled: completedEnabled,
              setEnabled: setCompletedEnabled,
              mode: completedRecipientMode,
              setMode: setCompletedRecipientMode,
              recipients: completedRecipients,
              setRecipients: setCompletedRecipients,
            },
          ].map((event) => (
            <fieldset key={event.key} className="rounded-lg border border-slate-200 p-3">
              <legend className="px-1 text-xs font-semibold text-slate-700">{event.label}</legend>
              <label className="flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={event.enabled}
                  onChange={(e) => event.setEnabled(e.target.checked)}
                  className="size-3.5 rounded border-slate-300"
                />
                Enviar e-mail neste evento
              </label>
              <label className="mt-3 block text-xs text-slate-600">
                Destinatário
                <select
                  value={event.mode}
                  disabled={!event.enabled}
                  onChange={(e) =>
                    event.setMode(e.target.value as "usuario" | "personalizado")
                  }
                  className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm disabled:bg-slate-100 disabled:text-slate-500"
                >
                  <option value="usuario">{event.usuarioLabel}</option>
                  <option value="personalizado">Endereços personalizados</option>
                </select>
              </label>
              {event.mode === "personalizado" ? (
                <label className="mt-3 block text-xs text-slate-600">
                  E-mails (um por linha ou separados por vírgula)
                  <textarea
                    value={event.recipients}
                    disabled={!event.enabled}
                    onChange={(e) => event.setRecipients(e.target.value)}
                    rows={3}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm disabled:bg-slate-100 disabled:text-slate-500"
                  />
                </label>
              ) : null}
            </fieldset>
          ))}
        </div>
        <button
          type="button"
          disabled={saveGravacaoNotificationsMutation.isPending}
          onClick={() => void saveGravacaoNotificationsMutation.mutate()}
          className="mt-3 inline-flex h-8 items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          {saveGravacaoNotificationsMutation.isPending ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Save className="size-3" />
          )}
          Salvar notificações
        </button>
      </ConfigSubsection>

      {!configQuery.isPending && !configQuery.isError ? (
        <ConfigSubsection
          tone="highlight"
          title={
            <span className="flex items-center gap-1.5 normal-case tracking-normal text-secondary-blue">
              <Send className="size-3.5" aria-hidden />
              Enviar e-mail de teste
            </span>
          }
          description={
            <>
              Envia o modelo selecionado na lista abaixo (com variáveis de exemplo) pelo Exchange.
              Assunto com prefixo <strong>[TESTE]</strong>.
              {selected ? (
                <>
                  {" "}
                  Modelo: <strong>{selected.label}</strong>. Remetente:{" "}
                  <span className="font-mono text-[10px]">{testFromMailbox}</span>
                </>
              ) : listSelection?.kind === "operational" ? (
                <>
                  {" "}
                  Modelo operacional selecionado — use o teste no painel central ou selecione um
                  modelo de conta/acesso.
                </>
              ) : (
                " Selecione um modelo na lista para habilitar o envio."
              )}
            </>
          }
        >
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-[14rem] flex-1 text-xs font-medium text-slate-700">
              E-mail que receberá o teste
              <input
                type="email"
                value={testRecipient}
                onChange={(e) => setTestRecipient(e.target.value)}
                placeholder="seu.email@camara.leg.br"
                className="mt-1 h-10 w-full max-w-lg rounded-lg border border-slate-300 bg-white px-3 text-sm shadow-sm"
              />
            </label>
            <button
              type="button"
              disabled={
                sendTestMutation.isPending ||
                !testRecipient.trim() ||
                !isSystemSelection ||
                !selectedId ||
                !selected
              }
              onClick={() => {
                if (
                  !window.confirm(
                    `Enviar e-mail de teste do modelo "${selected?.label ?? ""}" para ${testRecipient.trim()}?`,
                  )
                ) {
                  return;
                }
                void sendTestMutation.mutate();
              }}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-secondary-blue px-4 text-xs font-semibold text-white shadow-sm hover:bg-secondary-blue/90 disabled:opacity-50"
            >
              {sendTestMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              Enviar teste
            </button>
          </div>
        </ConfigSubsection>
      ) : null}

      {(configQuery.isPending || modelsQuery.isPending) ? (
        <ConfigLoadingState>
          <Loader2 className="size-4 animate-spin" />
          Carregando modelos…
        </ConfigLoadingState>
      ) : null}

      {configQuery.isError ? (
        <ConfigErrorState>
          {configQuery.error instanceof Error
            ? configQuery.error.message
            : "Erro ao carregar modelos de e-mail."}
        </ConfigErrorState>
      ) : null}

      {!configQuery.isPending && !configQuery.isError && listSelection ? (
        <div className="email-admin-three-col min-h-0">
          <div className="email-admin-col rounded border border-slate-200">
            <p className="shrink-0 border-b border-slate-200 bg-slate-50 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Modelos de e-mail
            </p>
            <div className="papelaria-admin-model-list">
              <div>
                <ConfigSidebarGroupLabel>Conta e acesso</ConfigSidebarGroupLabel>
                <ul className="space-y-0.5">
                  {systemTemplatesOrdered.map((tpl) => (
                    <li key={tpl.id}>
                      <button
                        type="button"
                        onClick={() => selectSystemTemplate(tpl)}
                        className={cn(
                          "w-full rounded-md px-2 py-1.5 text-left text-xs transition",
                          listSelectionActive({ kind: "system", id: tpl.id })
                            ? "bg-secondary-blue/10 font-semibold text-secondary-blue"
                            : "text-slate-700 hover:bg-slate-100",
                        )}
                      >
                        {tpl.label}
                        {tpl.use_custom ? (
                          <span className="ml-1 text-[10px] text-emerald-600">
                            • {tpl.content_mode === "preset" ? "padrão" : "HTML"}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              {OPERATIONAL_GRUPOS.map((grupo) => (
                <div key={grupo}>
                  <ConfigSidebarGroupLabel>{GRUPO_LABELS[grupo]}</ConfigSidebarGroupLabel>
                  {(operationalGrouped.get(grupo) ?? []).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => selectOperationalModel(m)}
                      className={cn(
                        "mb-0.5 flex w-full flex-col rounded-md px-2 py-1.5 text-left text-xs",
                        listSelection?.kind === "operational" && listSelection.id === m.id
                          ? "bg-secondary-blue/10 text-secondary-blue"
                          : "text-slate-700 hover:bg-slate-50",
                      )}
                    >
                      <span className="font-semibold">{m.nome}</span>
                      <span className="text-[10px] text-slate-500">
                        {VARIANTE_LABELS[m.variante]}
                        {m.ativo ? " · ativo" : ""}
                        {m.anexar_pdf ? " · anexo" : ""}
                        {m.preferir_prova_web ? " · prova WEB" : ""}
                      </span>
                    </button>
                  ))}
                  <div className="flex flex-wrap gap-1 px-1 pb-2">
                    {grupo !== "timbrado_a4_digital" ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded border border-dashed border-slate-300 px-2 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50"
                        onClick={() => startOperationalCreate(grupo, "portal")}
                      >
                        <Plus className="size-3" />
                        Novo (portal)
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded border border-dashed border-slate-300 px-2 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50"
                      onClick={() => startOperationalCreate(grupo, "sem_portal")}
                    >
                      <Plus className="size-3" />
                      {grupo === "timbrado_a4_digital"
                        ? "Novo modelo"
                        : "Novo (sem portal)"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {isOperationalSelection ? (
            <OperationalEmailEditorPanel
              selectedModelId={
                listSelection.kind === "operational" ? listSelection.id : null
              }
              creatingGrupo={
                listSelection.kind === "operational-create" ? listSelection.grupo : null
              }
              creatingVariante={
                listSelection.kind === "operational-create"
                  ? listSelection.variante
                  : creatingOperational?.variante ?? "portal"
              }
              onPreviewChange={handleOperationalPreviewChange}
              onHtmlEditorReady={handleOperationalHtmlEditorReady}
              onCreated={(model) => {
                setCreatingOperational(null);
                selectOperationalModel(model);
              }}
              onDeleted={() => {
                setListSelection(
                  systemTemplatesOrdered[0]
                    ? { kind: "system", id: systemTemplatesOrdered[0].id }
                    : null,
                );
                if (systemTemplatesOrdered[0]) {
                  selectSystemTemplate(systemTemplatesOrdered[0]);
                }
              }}
            />
          ) : selected ? (
          <div className="email-admin-col email-admin-editor-scroll space-y-3 rounded border border-slate-200 p-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">{selected.label}</h3>
              <p className="text-xs text-slate-500">{selected.description}</p>
            </div>

            <p className="text-xs text-slate-600">
              Escolha um <strong>modelo padrão</strong> (layout Outlook/HTML da Câmara) ou
              informe <strong>HTML personalizado</strong>. Depois clique em{" "}
              <strong>Salvar modelo</strong>.
            </p>

            {presetOptions.length > 0 ? (
              <fieldset className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                <legend className="px-1 text-xs font-semibold text-slate-700">
                  Formato do corpo do e-mail
                </legend>
                <label className="flex cursor-pointer items-start gap-2 text-xs text-slate-700">
                  <input
                    type="radio"
                    name="content-mode"
                    checked={contentMode === "preset"}
                    onChange={() => setContentMode("preset")}
                    className="mt-0.5"
                  />
                  <span>
                    <strong>Modelo padrão</strong> — layout pré-definido (arquivo OFT/HTML da
                    Câmara)
                  </span>
                </label>
                {contentMode === "preset" ? (
                  <div className="ml-5 space-y-3">
                    <p className="text-[10px] leading-relaxed text-slate-500">
                      <strong>1.</strong> Use um modelo já cadastrado na lista, ou envie um arquivo
                      novo abaixo. <strong>2.</strong> Depois clique em{" "}
                      <strong>Salvar modelo</strong> (se só mudou a lista) ou{" "}
                      <strong>Cadastrar e usar</strong> (se enviou arquivo novo).
                    </p>
                    <label className="block text-xs font-medium text-slate-600">
                      Modelo salvo no sistema
                      <select
                        value={presetId}
                        onChange={(e) => setPresetId(e.target.value)}
                        className="mt-1 h-9 w-full max-w-md rounded-lg border border-slate-300 bg-white px-2 text-sm"
                      >
                        {presetOptions.map((opt) => (
                          <option key={opt.id} value={opt.id}>
                            {opt.label}
                            {opt.uploaded ? " (cadastrado)" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    {presetId.startsWith("upload_") ? (
                      <button
                        type="button"
                        disabled={deletePresetMutation.isPending}
                        onClick={() => {
                          if (
                            !window.confirm(
                              "Remover este arquivo cadastrado? O modelo voltará ao padrão do sistema se estiver em uso.",
                            )
                          ) {
                            return;
                          }
                          void deletePresetMutation.mutate();
                        }}
                        className="inline-flex h-8 items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2 text-xs font-medium text-red-800 hover:bg-red-100 disabled:opacity-60"
                      >
                        {deletePresetMutation.isPending ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Trash2 className="size-3" />
                        )}
                        Excluir arquivo cadastrado
                      </button>
                    ) : null}
                    <div className="rounded-md border border-dashed border-slate-300 bg-white p-3">
                      <p className="text-xs font-medium text-slate-700">
                        Enviar novo arquivo HTML / OFT
                      </p>
                      <p className="mt-0.5 text-[10px] text-slate-500">
                        Exporte no Outlook:{" "}
                        <strong>Arquivo → Salvar como → Página da Web (.html) filtrada</strong>{" "}
                        (máx. 2 MB).
                      </p>
                      <input
                        ref={uploadInputRef}
                        id="email-preset-file-input"
                        type="file"
                        accept=".html,.htm,.oft,text/html"
                        className="sr-only"
                        onChange={(e) => onUploadFilePicked(e.target.files?.[0])}
                      />
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <label
                          htmlFor="email-preset-file-input"
                          className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-50 px-3 text-xs font-semibold text-slate-800 hover:bg-slate-100"
                        >
                          <Upload className="size-3.5" />
                          Escolher arquivo…
                        </label>
                        {selectedUploadFile ? (
                          <span className="max-w-full truncate text-xs text-emerald-700">
                            {selectedUploadFile.name} (
                            {(selectedUploadFile.size / 1024).toFixed(0)} KB)
                          </span>
                        ) : (
                          <span className="text-xs text-amber-700">
                            Nenhum arquivo escolhido ainda
                          </span>
                        )}
                      </div>
                      <input
                        type="text"
                        value={uploadLabel}
                        onChange={(e) => setUploadLabel(e.target.value)}
                        placeholder="Nome exibido na lista (opcional)"
                        className="mt-2 h-8 w-full max-w-md rounded-lg border border-slate-300 px-2 text-xs"
                      />
                      <button
                        type="button"
                        disabled={uploadPresetMutation.isPending || !selectedUploadFile}
                        onClick={() => void uploadPresetMutation.mutate()}
                        className="mt-2 inline-flex h-8 items-center gap-1 rounded-lg bg-secondary-blue px-3 text-xs font-semibold text-white hover:bg-secondary-blue/90 disabled:opacity-60"
                      >
                        {uploadPresetMutation.isPending ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Upload className="size-3" />
                        )}
                        Cadastrar e usar
                      </button>
                    </div>
                  </div>
                ) : null}
                <label className="flex cursor-pointer items-start gap-2 text-xs text-slate-700">
                  <input
                    type="radio"
                    name="content-mode"
                    checked={contentMode === "custom"}
                    onChange={() => setContentMode("custom")}
                    className="mt-0.5"
                  />
                  <span>
                    <strong>HTML personalizado</strong> — edite o código abaixo
                  </span>
                </label>
              </fieldset>
            ) : null}

            {showSubject ? (
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Assunto padrão</span>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 font-mono text-sm"
                />
                <span className="mt-0.5 block text-[10px] text-slate-400">
                  {variablesHint(selected.subject_variables)}
                </span>
              </label>
            ) : null}

            {showHtmlEditor ? (
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Corpo HTML</span>
                <textarea
                  value={html}
                  onChange={(e) => setHtml(e.target.value)}
                  rows={12}
                  spellCheck={false}
                  className="mt-1 w-full resize-y rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs leading-relaxed"
                />
                <span className="mt-0.5 block text-[10px] text-slate-400">
                  {variablesHint(selected.html_variables)}
                  {selected.id === "pt_report_wrapper" ? "  #HTMLAQUI" : ""}
                </span>
              </label>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={saveTemplateMutation.isPending}
                onClick={() => void saveTemplateMutation.mutate()}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary-green px-3 text-xs font-semibold text-white hover:bg-primary-green/90 disabled:opacity-60"
              >
                {saveTemplateMutation.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Save className="size-3.5" />
                )}
                Salvar modelo
              </button>
              <button
                type="button"
                disabled={previewMutation.isPending}
                onClick={() => void previewMutation.mutate()}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                {previewMutation.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Eye className="size-3.5" />
                )}
                Pré-visualizar (atualizar)
              </button>
              <button
                type="button"
                disabled={resetMutation.isPending}
                onClick={() => {
                  if (!window.confirm("Restaurar este modelo para o padrão do sistema?")) return;
                  void resetMutation.mutate();
                }}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-60"
              >
                {resetMutation.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="size-3.5" />
                )}
                Restaurar padrão
              </button>
            </div>
          </div>
          ) : (
            <div className="email-admin-col flex items-center justify-center rounded border border-dashed border-slate-200 bg-slate-50/50 p-6 text-xs text-slate-500">
              Selecione um modelo na lista.
            </div>
          )}

          <EmailLivePreviewPanel
            subject={displayPreviewSubject}
            html={displayPreviewHtml}
            loading={previewLoading}
            editable={previewEditable}
            onHtmlChange={
              isOperationalSelection
                ? handleOperationalPreviewHtmlChange
                : handlePreviewHtmlChange
            }
            onFocusChange={setPreviewFocused}
            emptyMessage={
              isOperationalSelection
                ? "Edite o HTML do modelo operacional para ver a prévia."
                : contentMode === "preset"
                  ? "Selecione um modelo padrão para ver a prévia renderizada."
                  : "Edite o HTML para ver a prévia em tempo real."
            }
          />
        </div>
      ) : null}
      </ConfigSectionBody>
    </ConfigSection>
  );
}
