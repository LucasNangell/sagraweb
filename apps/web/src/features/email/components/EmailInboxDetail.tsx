import { cn } from "@sagra/ui";
import {
  Ban,
  ChevronDown,
  ChevronUp,
  Download,
  File,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  Loader2,
  Paperclip,
  Reply,
  Send,
  Save,
  Workflow,
} from "lucide-react";
import { useEffect, useState } from "react";

import { emailDownloadUrl } from "@/api/email";
import { usePendenciaProtocolo } from "@/api/hooks/useEmailQueries";
import {
  OS_ANO_MAX,
  OS_ANO_MIN,
  normalizeAno,
  parseOsAnoPair,
} from "@/features/os/osAnoUtils";
import type { AndamentoResult, InboxEmail } from "../types";
import {
  attachmentIconClass,
  formatEmailDate,
  hasVisibleHtmlContent,
  parseOsAno,
  prepareInboxEmailBodyParts,
  senderInitials,
} from "../utils";
import { EmailEmptyState } from "./EmailEmptyState";
import { EmailHtmlViewer } from "./EmailHtmlViewer";
import { emailInputClass, emailLabelClass, emailPanelClass } from "./email-ui";

interface EmailInboxDetailProps {
  email: InboxEmail | null;
  ponto: string;
  onToast: (msg: string) => void;
  onClearSelection: () => void;
  onSendAndamento: (payload: {
    os: number;
    ano: number;
    situacao: string;
    setor: string;
    observacao: string;
    email_entry_id: string | null;
  }) => Promise<AndamentoResult>;
  onMarkRead: (emailEntryId: string) => Promise<void>;
  onReply: (payload: {
    os: number;
    ano: number;
    email_entry_id: string | null;
  }) => Promise<void>;
  onSaveEmail: (payload: {
    os: number;
    ano: number;
    email_entry_id: string;
  }) => Promise<void>;
  sendingAndamento: boolean;
  markingRead: boolean;
  replying: boolean;
  savingMht: boolean;
}

function AttachmentIcon({ name }: { name?: string }) {
  const ext = name?.split(".").pop()?.toLowerCase() ?? "";
  const cls = cn("size-4 shrink-0", attachmentIconClass(name));
  if (ext === "pdf") return <FileText className={cls} aria-hidden />;
  if (["jpg", "jpeg", "png", "gif"].includes(ext))
    return <FileImage className={cls} aria-hidden />;
  if (["doc", "docx"].includes(ext)) return <File className={cls} aria-hidden />;
  if (["xls", "xlsx"].includes(ext))
    return <FileSpreadsheet className={cls} aria-hidden />;
  if (["zip", "rar"].includes(ext))
    return <FileArchive className={cls} aria-hidden />;
  return <File className={cls} aria-hidden />;
}

export function EmailInboxDetail({
  email,
  ponto,
  onToast,
  onClearSelection,
  onSendAndamento,
  onMarkRead,
  onReply,
  onSaveEmail,
  sendingAndamento,
  markingRead,
  replying,
  savingMht,
}: EmailInboxDetailProps) {
  const [os, setOs] = useState<number | "">("");
  const [ano, setAno] = useState<number | "">("");
  const [situacao, setSituacao] = useState("Em Execução");
  const [setor, setSetor] = useState("SEFOC");
  const [observacao, setObservacao] = useState("");
  const [showQuoted, setShowQuoted] = useState(false);

  useEffect(() => {
    if (!email) {
      setOs("");
      setAno("");
      setObservacao("");
      return;
    }
    const parsed = parseOsAno(email.subject);
    setOs(parsed.os);
    setAno(parsed.ano);
    setObservacao("");
  }, [email?.id, email?.subject]);

  useEffect(() => {
    setShowQuoted(false);
  }, [email?.id]);

  const osAnoPair = parseOsAnoPair(os, ano);
  const protocoloQuery = usePendenciaProtocolo(
    osAnoPair?.ano ?? null,
    osAnoPair?.os ?? null,
  );
  const protocoloFound = protocoloQuery.data?.NroProtocolo != null;
  const anoInvalido = ano !== "" && normalizeAno(ano) == null;
  const osReady = osAnoPair != null && protocoloFound && !protocoloQuery.isFetching;
  const protocoloLabel = protocoloFound
    ? [
        protocoloQuery.data?.NomeUsuario,
        protocoloQuery.data?.CategoriaLink,
      ]
        .filter((part) => part && String(part).trim())
        .join(" — ")
    : "";

  if (!email) {
    return <EmailEmptyState />;
  }

  const { main: replyBody, quoted: quotedBody } = prepareInboxEmailBodyParts(
    email.body,
    {
      entryId: email.real_id,
      inlineImages: email.inline_images,
      buildDownloadUrl: emailDownloadUrl,
    },
  );
  const hasReplyText = hasVisibleHtmlContent(replyBody);
  const isSepim = !email.account?.includes("papelaria");

  const handleSend = async () => {
    if (!osAnoPair || !osReady) {
      window.alert("Informe uma OS existente (número e ano válidos).");
      return;
    }
    try {
      const result = await onSendAndamento({
        os: osAnoPair.os,
        ano: osAnoPair.ano,
        situacao,
        setor,
        observacao,
        email_entry_id: email.real_id ?? null,
      });
      if (result.outlook_updated === false) {
        onToast(
          "Andamento lançado, mas não foi possível marcar o e-mail no Outlook",
        );
      } else {
        onToast("Andamento Em Execução criado com sucesso!");
      }
      setObservacao("");
      setOs("");
      setAno("");
      onClearSelection();
    } catch (e) {
      window.alert(
        `Erro ao enviar para execução: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };

  const handleDesconsiderar = async () => {
    try {
      await onMarkRead(email.real_id);
      onToast("E-mail desconsiderado (Outlook atualizado). Nenhum andamento gerado.");
      setOs("");
      setAno("");
      onClearSelection();
    } catch (e) {
      window.alert(
        `Erro ao desconsiderar: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };

  const handleReply = async () => {
    if (!osAnoPair || !osReady) {
      window.alert("Informe uma OS existente (número e ano válidos).");
      return;
    }
    try {
      await onReply({
        os: osAnoPair.os,
        ano: osAnoPair.ano,
        email_entry_id: email.real_id ?? null,
      });
      onToast("Resposta enviada ao remetente!");
      setOs("");
      setAno("");
      onClearSelection();
    } catch (e) {
      window.alert(`Erro ao responder: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleSaveMht = async () => {
    if (!osAnoPair || !osReady) {
      window.alert("Informe uma OS existente (número e ano válidos).");
      return;
    }
    if (!email.real_id) {
      window.alert("Não foi possível identificar o e-mail no Exchange.");
      return;
    }
    try {
      await onSaveEmail({
        os: osAnoPair.os,
        ano: osAnoPair.ano,
        email_entry_id: email.real_id,
      });
      onToast("E-mail salvo em .mht na pasta Sefoc da OS.");
    } catch (e) {
      window.alert(
        `Erro ao salvar e-mail (.mht): ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden lg:flex-row lg:overflow-hidden">
      {/* Painel de leitura */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="shrink-0 border-b border-slate-200/80 bg-white px-4 py-4 sm:px-5">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <h1 className="min-w-0 flex-1 text-lg font-semibold leading-snug text-slate-900">
              {email.subject}
            </h1>
            <time
              className="shrink-0 text-xs tabular-nums text-slate-500"
              dateTime={email.date}
            >
              {formatEmailDate(email.date)}
            </time>
          </div>

          <div className="flex items-start gap-3">
            <div
              className={cn(
                "flex size-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white",
                isSepim ? "bg-indigo-600" : "bg-orange-600",
              )}
            >
              {senderInitials(email.sender)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-800">{email.sender}</p>
              <p className="truncate text-xs text-slate-500">{email.email}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "rounded-md px-1.5 py-0.5 text-[0.65rem] font-bold uppercase",
                    isSepim
                      ? "bg-indigo-100 text-indigo-800"
                      : "bg-orange-100 text-orange-900",
                  )}
                >
                  {isSepim ? "SEPIM" : "PAPELARIA"}
                </span>
                <span className="text-xs text-slate-500">{email.folder}</span>
              </div>
            </div>
          </div>

          {email.attachments?.length > 0 ? (
            <div className="mt-4 border-t border-slate-100 pt-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <Paperclip className="size-3.5" aria-hidden />
                {email.attachments.length} anexo
                {email.attachments.length !== 1 ? "s" : ""}
              </p>
              <div className="flex flex-wrap gap-2">
                {email.attachments.map((att, index) => (
                  <a
                    key={`${att.name}-${att.index ?? index}`}
                    href={emailDownloadUrl(email.real_id, att.index ?? index + 1)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex max-w-full items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 no-underline visited:text-slate-700 transition hover:border-slate-300 hover:bg-white hover:shadow-sm"
                  >
                    <AttachmentIcon name={att.name} />
                    <span className="truncate">{att.name || "Anexo"}</span>
                    <Download className="size-3 shrink-0 text-slate-400" aria-hidden />
                  </a>
                ))}
              </div>
            </div>
          ) : null}
        </header>

        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain bg-white px-3 py-4 sm:px-5">
          {hasReplyText ? (
            <EmailHtmlViewer
              html={replyBody}
              hideImages
              className="rounded-lg border border-slate-100 bg-slate-50/30 p-3 sm:p-4"
            />
          ) : quotedBody ? (
            <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 px-4 py-3 text-sm italic text-slate-500">
              Resposta sem texto — expanda a mensagem anterior abaixo.
            </p>
          ) : (
            <EmailHtmlViewer
              html={replyBody}
              hideImages
              className="rounded-lg border border-slate-100 bg-slate-50/30 p-3 sm:p-4"
            />
          )}

          {quotedBody ? (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setShowQuoted((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-secondary-blue shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
              >
                {showQuoted ? (
                  <>
                    <ChevronUp className="size-3.5 shrink-0" aria-hidden />
                    Ocultar mensagem anterior
                  </>
                ) : (
                  <>
                    <ChevronDown className="size-3.5 shrink-0" aria-hidden />
                    Ver mensagem anterior
                  </>
                )}
              </button>

              {showQuoted ? (
                <EmailHtmlViewer
                  html={quotedBody}
                  hideImages
                  className="mt-3 rounded-lg border border-slate-200 bg-slate-100/40 p-3 opacity-95 sm:p-4"
                />
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {/* Painel de workflow (lateral) */}
      <aside className={emailPanelClass}>
        <div className="shrink-0 border-b border-slate-200/80 px-4 py-3.5">
          <div className="flex items-center gap-2 text-secondary-blue">
            <Workflow className="size-4" aria-hidden />
            <h2 className="text-sm font-bold text-slate-800">
              Enviar para Execução
            </h2>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Vincule o e-mail a uma OS e registre o andamento.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div className="grid grid-cols-2 gap-3">
            <label className={emailLabelClass}>
              Nr OS
              <input
                type="number"
                min={1}
                value={os}
                onChange={(e) =>
                  setOs(e.target.value ? Number(e.target.value) : "")
                }
                className={emailInputClass}
              />
            </label>
            <label className={emailLabelClass}>
              Ano
              <input
                type="number"
                min={OS_ANO_MIN}
                max={OS_ANO_MAX}
                value={ano}
                onChange={(e) =>
                  setAno(e.target.value ? Number(e.target.value) : "")
                }
                onBlur={() => {
                  const expanded = normalizeAno(ano);
                  if (expanded != null && expanded !== ano) {
                    setAno(expanded);
                  }
                }}
                className={emailInputClass}
              />
            </label>
          </div>
          {anoInvalido ? (
            <p className="mt-2 text-xs text-red-600">
              Ano inválido. Use 2 dígitos (26) ou 4 dígitos entre {OS_ANO_MIN} e{" "}
              {OS_ANO_MAX}.
            </p>
          ) : osAnoPair && protocoloQuery.isFetching ? (
            <p className="mt-2 text-xs text-slate-500">Verificando OS…</p>
          ) : osAnoPair && !protocoloFound ? (
            <p className="mt-2 text-xs text-red-600">
              OS {osAnoPair.os}/{osAnoPair.ano} não encontrada.
            </p>
          ) : osAnoPair && osReady && protocoloLabel ? (
            <p className="mt-2 text-xs text-slate-600">
              OS {osAnoPair.os}/{osAnoPair.ano}
              {protocoloLabel ? ` — ${protocoloLabel}` : ""}
            </p>
          ) : null}

          <label className={cn(emailLabelClass, "mt-3 block")}>
            Situação
            <select
              value={situacao}
              onChange={(e) => setSituacao(e.target.value)}
              className={emailInputClass}
            >
              <option value="Em Execução">Em Execução</option>
              <option value="Aguardando">Aguardando</option>
              <option value="Finalizado">Finalizado</option>
            </select>
          </label>

          <label className={cn(emailLabelClass, "mt-3 block")}>
            Setor
            <select
              value={setor}
              onChange={(e) => setSetor(e.target.value)}
              className={emailInputClass}
            >
              <option value="SEFOC">SEFOC</option>
              <option value="Arquivo">Arquivo</option>
              <option value="Diretoria">Diretoria</option>
            </select>
          </label>

          <label className={cn(emailLabelClass, "mt-3 block")}>
            Observação
            <textarea
              rows={4}
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder="Digite observações sobre o encaminhamento…"
              className={cn(emailInputClass, "resize-y min-h-[88px]")}
            />
          </label>
        </div>

        <div className="shrink-0 space-y-2 border-t border-slate-200/80 bg-white/60 px-4 py-4">
          <button
            type="button"
            disabled={sendingAndamento || !osReady}
            onClick={() => void handleSend()}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-secondary-blue py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-secondary-blue/90 disabled:opacity-60"
          >
            {sendingAndamento ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Send className="size-4" aria-hidden />
            )}
            Enviar p/ Execução
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={markingRead}
              onClick={() => void handleDesconsiderar()}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 py-2 text-xs font-semibold text-amber-900 transition hover:bg-amber-100 disabled:opacity-60"
            >
              {markingRead ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <Ban className="size-3.5" aria-hidden />
              )}
              Desconsiderar
            </button>
            <button
              type="button"
              disabled={replying || !osReady}
              onClick={() => void handleReply()}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 py-2 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-60"
            >
              {replying ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <Reply className="size-3.5" aria-hidden />
              )}
              Responder
            </button>
          </div>
          <button
            type="button"
            disabled={savingMht || !osReady}
            onClick={() => void handleSaveMht()}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 py-2 text-xs font-semibold text-sky-800 transition hover:bg-sky-100 disabled:opacity-60"
          >
            {savingMht ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Save className="size-3.5" aria-hidden />
            )}
            Salvar e-mail (.mht)
          </button>
          <p className="text-center text-[0.65rem] text-slate-400">
            Operador: ponto {ponto || "—"}
          </p>
        </div>
      </aside>
    </div>
  );
}
