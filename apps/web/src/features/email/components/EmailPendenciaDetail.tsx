import { cn } from "@sagra/ui";
import {
  AlertTriangle,
  FileText,
  Info,
  Loader2,
  Send,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { emailDownloadUrl, fetchGalResolve } from "@/api/email";
import {
  useDeputadoEmailsQuery,
  useEmailProofFiles,
  usePendenciaProtocolo,
  usePtHtml,
} from "@/api/hooks/useEmailQueries";
import type { PendenciaOs } from "../types";
import { extractEmailsSimple, extractPontosSimple, isApogeePendencia, normalizeText, prepareApogeeEmailBody } from "../utils";
import { EmailEmptyState } from "./EmailEmptyState";
import { EmailGalLookupField } from "./EmailGalLookupField";
import { EmailHtmlViewer } from "./EmailHtmlViewer";
import {
  EmailProofFileSelector,
  isProofSendBlocked,
} from "./EmailProofFileSelector";
import { EmailHtmlEditor } from "./EmailHtmlEditor";
import { emailInputClass, emailLabelClass, emailPanelClass } from "./email-ui";
import { osRelativePathToProofFilename } from "../utils/proofFilePicker";
import {
  OsFolderBrowserModal,
  type OsFolderPdfPick,
} from "@/features/os/components/OsFolderBrowserModal";
import type { OsSearchRow } from "@/features/os/types";

interface EmailPendenciaDetailProps {
  item: PendenciaOs | null;
  ponto: string;
  onToast: (msg: string) => void;
  onSendEmail: (payload: {
    os: number;
    ano: number;
    versao?: string;
    to: string[];
    type: string;
    proof_filename?: string;
    html?: string;
    subject?: string;
    email_entry_id?: string;
  }) => Promise<SendPtResultLike>;
  onRegisterAndamento: (payload: {
    os: number;
    ano: number;
    versao?: string;
    type: string;
    proof_filename?: string;
    send_mode?: string;
    to?: string[];
  }) => Promise<unknown>;
  sending: boolean;
  registeringAndamento: boolean;
}

interface SendPtResultLike {
  message?: string;
  attachments?: string[];
}

export function EmailPendenciaDetail({
  item,
  ponto,
  onToast,
  onSendEmail,
  onRegisterAndamento,
  sending,
  registeringAndamento,
}: EmailPendenciaDetailProps) {
  const [versao, setVersao] = useState("");
  const [emailDep, setEmailDep] = useState("");
  const [emailGab, setEmailGab] = useState("");
  const [emailsContato, setEmailsContato] = useState<string[]>([""]);
  const [solicitante, setSolicitante] = useState("");
  const [selectedProofFile, setSelectedProofFile] = useState("");
  const [editedHtml, setEditedHtml] = useState("");
  const [originalHtml, setOriginalHtml] = useState("");
  const [proofFolderPickerOpen, setProofFolderPickerOpen] = useState(false);

  const os = item?.os ?? null;
  const ano = item?.ano ?? null;
  const isApogee = item ? isApogeePendencia(item) : false;

  const apogeePreviewHtml = useMemo(() => {
    if (!isApogee || !item?.body) return "";
    return prepareApogeeEmailBody(item.body, {
      entryId: item.email_entry_id,
      inlineImages: item.inline_images,
      buildDownloadUrl: emailDownloadUrl,
    });
  }, [isApogee, item?.body, item?.email_entry_id, item?.inline_images]);

  const ptQuery = usePtHtml(ano, os, !isApogee);
  const protocoloQuery = usePendenciaProtocolo(ano, os);

  const emailType = isApogee ? "apogee" : (ptQuery.data?.type ?? "pt");
  const isTimbradoMode =
    !isApogee &&
    emailType === "timbrado_digital" &&
    !ptQuery.isLoading &&
    !ptQuery.isError;
  const isProofMode =
    !isApogee &&
    emailType === "proof" &&
    !ptQuery.isLoading &&
    !ptQuery.isError;
  const proofUsesAttachment =
    isProofMode &&
    (ptQuery.data?.anexar_pdf === true || ptQuery.data?.send_mode === "anexo");
  const ptUsesInline =
    emailType === "pt" &&
    (ptQuery.data?.use_inline_body === true || ptQuery.data?.send_mode === "sem_portal");

  const proofFilesQuery = useEmailProofFiles(ano, os, isProofMode);

  const requiresVersao = !isApogee && !isTimbradoMode;

  const isDeputado =
    protocoloQuery.data?.CategoriaLink?.toUpperCase() === "DEPUTADO";
  const nomeUsuario = protocoloQuery.data?.NomeUsuario ?? "";
  const contatoTrab = protocoloQuery.data?.ContatoTrab ?? "";

  const deputadoQuery = useDeputadoEmailsQuery(
    nomeUsuario,
    os,
    ano,
    Boolean(isDeputado && nomeUsuario),
  );

  useEffect(() => {
    if (!item) {
      setVersao("");
      setEmailDep("");
      setEmailGab("");
      setEmailsContato([""]);
      setSolicitante("");
      setSelectedProofFile("");
      setEditedHtml("");
      setOriginalHtml("");
      return;
    }
    setVersao("");
    setEmailDep("");
    setEmailGab("");
    setEmailsContato([""]);
    setSolicitante("");
    setSelectedProofFile("");
    setEditedHtml("");
    setOriginalHtml("");
  }, [item ? `${item.source ?? "db"}-${item.os}-${item.ano}-${item.email_entry_id ?? ""}` : null]);

  useEffect(() => {
    const data = protocoloQuery.data;
    if (!data) return;
    if (data.NomeUsuario) setSolicitante(data.NomeUsuario);

    const contato = data.ContatoTrab;
    if (!contato) return;

    const emails = extractEmailsSimple(contato);
    if (emails.length > 0) {
      setEmailsContato(emails);
      return;
    }

    const pontos = extractPontosSimple(contato);
    if (pontos.length === 0) return;

    let cancelled = false;
    void (async () => {
      const resolved = await Promise.all(
        pontos.map(async (ponto) => {
          try {
            const res = await fetchGalResolve(ponto);
            return res.items[0]?.email ?? "";
          } catch {
            return "";
          }
        }),
      );
      if (cancelled) return;
      setEmailsContato(resolved.length > 0 ? resolved : [""]);
    })();
    return () => {
      cancelled = true;
    };
  }, [protocoloQuery.data]);

  useEffect(() => {
    const dep = deputadoQuery.data;
    if (!dep) return;
    if (dep.email_dep) setEmailDep(dep.email_dep);
    if (dep.email_gab) setEmailGab(dep.email_gab);
    const contatoFromDep = dep.email_contato
      ? dep.email_contato
          .split(";")
          .map((e) => e.trim())
          .filter(Boolean)
      : [];
    const hasContatoFilled = emailsContato.some((e) => e.trim());
    if (contatoFromDep.length > 0 && !hasContatoFilled) {
      setEmailsContato(contatoFromDep);
    }
    if (!dep.email_dep && dep.ramal) setEmailDep(dep.ramal);
    if (!dep.email_gab && dep.gabinete) setEmailGab(dep.gabinete);
  }, [deputadoQuery.data, emailsContato]);

  useEffect(() => {
    if (ptQuery.data?.versao && !versao) {
      setVersao(String(ptQuery.data.versao));
    }
  }, [ptQuery.data?.versao, versao]);

  useEffect(() => {
    const loaded = ptQuery.data?.html ?? "";
    if (!loaded) return;
    setEditedHtml(loaded);
    setOriginalHtml(loaded);
  }, [ptQuery.data?.html, item ? `${item.os}-${item.ano}` : null]);

  useEffect(() => {
    if (!isProofMode || !proofFilesQuery.data) return;
    const { files, suggested } = proofFilesQuery.data;
    if (files.length === 0) {
      setSelectedProofFile("");
      return;
    }
    if (selectedProofFile && files.some((f) => f.name === selectedProofFile)) {
      return;
    }
    const auto =
      suggested && files.some((f) => f.name === suggested)
        ? suggested
        : files.length === 1
          ? files[0].name
          : "";
    setSelectedProofFile(auto);
  }, [isProofMode, proofFilesQuery.data, selectedProofFile]);

  if (!item) {
    return (
      <EmailEmptyState
        title="Nenhuma pendência selecionada"
        description="Escolha uma OS na lista para revisar a prévia do e-mail e enviar ao solicitante."
        icon={FileText}
      />
    );
  }

  const html = editedHtml || ptQuery.data?.html || "";
  const htmlEdited = Boolean(
    originalHtml && editedHtml && editedHtml.trim() !== originalHtml.trim(),
  );

  const proofBlocked = isProofSendBlocked(
    emailType,
    proofFilesQuery.isLoading,
    proofFilesQuery.isError,
    proofFilesQuery.data?.files.length ?? 0,
    selectedProofFile,
  );
  const timbradoBlocked =
    isTimbradoMode && !(ptQuery.data?.timbrado_attachments?.length);

  const proofFolderRow: OsSearchRow | null =
    item && isProofMode
      ? {
          nr_os: item.os,
          ano: item.ano,
          produto: item.produto,
          situacao: item.situacao,
          setor: item.setor,
        }
      : null;

  const handleProofPdfPick = (pick: OsFolderPdfPick) => {
    const proofFilename = osRelativePathToProofFilename(pick.relative);
    if (!proofFilename) {
      window.alert("Selecione um PDF dentro da pasta Sefoc.");
      return;
    }
    setSelectedProofFile(proofFilename);
  };

  const handleSend = async () => {
    if (requiresVersao && !versao.trim()) {
      window.alert("Preencha o número da versão (ex: 1, 2, 3...)");
      return;
    }
    if (emailType === "proof" && !isApogee && !selectedProofFile.trim()) {
      window.alert("Selecione o PDF de prova que será enviado ao cliente.");
      return;
    }
    if (
      emailType === "timbrado_digital" &&
      !isApogee &&
      !(ptQuery.data?.timbrado_attachments?.length)
    ) {
      window.alert(
        "DOCX do Timbrado A4 Digital não encontrados na pasta Sefoc. Gere o Timbrado Digital antes de enviar.",
      );
      return;
    }
    if (isApogee && !item.body?.trim()) {
      window.alert("Corpo do e-mail Apogee indisponível para envio.");
      return;
    }
    const destinatarios = [emailDep, emailGab, ...emailsContato]
      .map((e) => e.trim())
      .filter(Boolean);
    if (destinatarios.length === 0) {
      window.alert("Preencha pelo menos um e-mail de destinatário");
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    for (const addr of destinatarios) {
      if (!emailRegex.test(addr)) {
        window.alert(`E-mail inválido: ${addr}`);
        return;
      }
    }
    try {
      const result = await onSendEmail({
        os: item.os,
        ano: item.ano,
        versao: versao.trim() || undefined,
        to: destinatarios,
        type: isApogee ? "apogee" : emailType,
        ...(isApogee
          ? {
              html: item.body?.trim() ?? "",
              subject: item.subject?.trim() ?? "",
              email_entry_id: item.email_entry_id,
            }
          : {}),
        ...(htmlEdited && html.trim() && !isApogee ? { html: html.trim() } : {}),
        ...(emailType === "proof" && !isApogee
          ? { proof_filename: selectedProofFile.trim() }
          : {}),
      });
      let msg = result.message || "E-mail enviado com sucesso!";
      if (result.attachments?.length) {
        msg += `\nAnexo(s): ${result.attachments.join(", ")}`;
      }
      onToast(msg);

      const shouldRegisterAndamento = window.confirm(
        "E-mail enviado com sucesso.\n\nDeseja lançar o andamento nesta OS?",
      );
      if (shouldRegisterAndamento) {
        try {
          await onRegisterAndamento({
            os: item.os,
            ano: item.ano,
            versao: versao.trim() || undefined,
            type: isApogee ? "apogee" : emailType,
            to: destinatarios,
            ...(emailType === "proof" && !isApogee
              ? {
                  proof_filename: selectedProofFile.trim() || undefined,
                  send_mode: ptQuery.data?.send_mode ?? undefined,
                }
              : {}),
          });
          onToast("Andamento registrado com sucesso.");
          window.alert("E-mail enviado e andamento registrado.");
        } catch (andamentoErr) {
          window.alert(
            `E-mail enviado, mas falha ao registrar andamento: ${
              andamentoErr instanceof Error ? andamentoErr.message : String(andamentoErr)
            }`,
          );
        }
      } else {
        window.alert(msg);
      }
      setVersao("");
      setEmailDep("");
      setEmailGab("");
      setEmailsContato([""]);
      setSelectedProofFile("");
    } catch (e) {
      window.alert(
        `Erro ao enviar e-mail: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };

  let previewContent: ReactNode;
  if (isApogee) {
    previewContent = apogeePreviewHtml ? (
      <>
        <div className="border-b border-violet-200 bg-violet-50 px-4 py-2.5 text-center text-xs text-violet-900">
          Origem: <strong>Apogee</strong>
          {item.subject ? (
            <>
              {" "}
              · <span className="font-medium">{item.subject}</span>
            </>
          ) : null}
        </div>
        <EmailHtmlViewer html={apogeePreviewHtml} className="p-4" />
      </>
    ) : (
      <div className="px-8 py-12 text-center">
        <XCircle className="mx-auto mb-3 size-10 text-red-400" aria-hidden />
        <p className="text-sm text-slate-600">Corpo do e-mail indisponível</p>
      </div>
    );
  } else if (ptQuery.isLoading) {
    previewContent = (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-slate-400">
        <Loader2 className="size-10 animate-spin" aria-hidden />
        <p className="text-sm">Carregando prévia do banco…</p>
      </div>
    );
  } else if (ptQuery.isError) {
    const detail =
      ptQuery.error instanceof Error ? ptQuery.error.message : "Erro desconhecido";
    previewContent = (
      <div className="px-8 py-12 text-center">
        <AlertTriangle className="mx-auto mb-3 size-10 text-amber-500" aria-hidden />
        <h4 className="font-semibold text-amber-900">HTML não encontrado</h4>
        <p className="mt-2 text-sm text-slate-600">{detail}</p>
      </div>
    );
  } else if (html) {
    previewContent = (
      <>
        {emailType === "proof" ? (
          <div
            className={cn(
              "border-b px-4 py-2.5 text-center text-xs",
              selectedProofFile
                ? "border-amber-200 bg-amber-50 text-amber-900"
                : "border-slate-200 bg-slate-50 text-slate-700",
            )}
          >
            Modo: <strong>Envio de Prova</strong>
            {proofUsesAttachment ? (
              <> — o PDF será <strong>anexado</strong> ao e-mail</>
            ) : (
              <> — envio com <strong>link do portal</strong> (sem anexo)</>
            )}
            {selectedProofFile ? (
              <>
                {" "}
                · PDF: <strong>{selectedProofFile}</strong>
              </>
            ) : proofFilesQuery.isLoading ? (
              <> · carregando arquivos…</>
            ) : (
              <> · selecione o PDF no formulário ao lado</>
            )}
          </div>
        ) : ptUsesInline ? (
          <div className="border-b border-violet-200 bg-violet-50 px-4 py-2.5 text-center text-xs text-violet-900">
            Modo: <strong>Problemas técnicos</strong> — corpo inline no e-mail (sem link do
            portal)
          </div>
        ) : emailType === "pt" ? (
          <div className="border-b border-sky-200 bg-sky-50 px-4 py-2.5 text-center text-xs text-sky-900">
            Modo: <strong>Problemas técnicos</strong> — relatório com portal/link conforme modelo
            ativo
          </div>
        ) : null}
        <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-center text-xs text-emerald-900">
          Clique no texto da prévia para <strong>editar</strong> antes do envio.
          {htmlEdited ? (
            <>
              {" "}
              ·{" "}
              <button
                type="button"
                className="font-semibold underline hover:text-emerald-950"
                onClick={() => setEditedHtml(originalHtml)}
              >
                Restaurar original
              </button>
            </>
          ) : null}
        </div>
        <EmailHtmlEditor html={html} onChange={setEditedHtml} className="p-2" />
      </>
    );
  } else {
    previewContent = (
      <div className="px-8 py-12 text-center">
        <XCircle className="mx-auto mb-3 size-10 text-red-400" aria-hidden />
        <p className="text-sm text-slate-600">Prévia indisponível</p>
      </div>
    );
  }

  const sendDisabled =
    sending ||
    registeringAndamento ||
    (isApogee
      ? !apogeePreviewHtml
      : ptQuery.isLoading ||
        ptQuery.isError ||
        !html ||
        (emailType === "proof" && proofBlocked) ||
        (emailType === "timbrado_digital" && timbradoBlocked));

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden lg:flex-row lg:overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="shrink-0 border-b border-slate-200/80 bg-white px-4 py-3.5 sm:px-5">
          <h1 className="text-base font-semibold text-slate-900">
            {item.os >= 5000 ? "SP" : "OS"} {item.os}/{String(item.ano).slice(-2)}
            {item.produto ? (
              <span className="font-normal text-slate-500"> · {item.produto}</span>
            ) : null}
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {isApogee ? (
              <>
                Apogee
                {item.subject ? ` · ${item.subject}` : ""}
              </>
            ) : (
              <>
                {item.situacao} — {item.setor}
              </>
            )}
          </p>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-slate-50/40">
          <div className="m-3 overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-sm sm:m-4">
            {previewContent}
          </div>
        </div>
      </div>

      <aside className={emailPanelClass}>
        <div className="shrink-0 border-b border-slate-200/80 px-4 py-3.5">
          <div className="flex items-center gap-2 text-secondary-blue">
            <Send className="size-4" aria-hidden />
            <h2 className="text-sm font-bold text-slate-800">Envio de e-mail</h2>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {requiresVersao
              ? "Confira destinatários e versão antes de enviar."
              : "Confira os destinatários antes de enviar."}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div className="grid grid-cols-2 gap-3">
            <label className={emailLabelClass}>
              Nr OS
              <input
                type="number"
                readOnly
                value={item.os}
                className={cn(emailInputClass, "bg-slate-100")}
              />
            </label>
            <label className={emailLabelClass}>
              Ano
              <input
                type="number"
                readOnly
                value={item.ano}
                className={cn(emailInputClass, "bg-slate-100")}
              />
            </label>
          </div>

          {requiresVersao ? (
            <label className={cn(emailLabelClass, "mt-3 block")}>
              Versão
              <input
                type="text"
                required
                value={versao}
                onChange={(e) => setVersao(e.target.value)}
                placeholder="Ex: 1, 2, 3…"
                className={emailInputClass}
              />
            </label>
          ) : null}

          {isProofMode ? (
            <EmailProofFileSelector
              files={proofFilesQuery.data?.files ?? []}
              suggested={proofFilesQuery.data?.suggested ?? null}
              selectedFilename={selectedProofFile}
              onSelect={setSelectedProofFile}
              onChangeFile={() => setProofFolderPickerOpen(true)}
              isLoading={proofFilesQuery.isLoading}
              isError={proofFilesQuery.isError}
              errorMessage={
                proofFilesQuery.error instanceof Error
                  ? proofFilesQuery.error.message
                  : undefined
              }
            />
          ) : null}

          {isTimbradoMode ? (
            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[11px] font-semibold text-slate-700">
                Anexos Timbrado A4 Digital
              </p>
              <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-slate-600">
                {(ptQuery.data?.timbrado_attachments ?? []).map((f) => (
                  <li key={f.name}>{f.name}</li>
                ))}
                {!ptQuery.data?.timbrado_attachments?.length ? (
                  <li className="text-amber-700">
                    DOCX não encontrados em Sefoc — gere o Timbrado Digital.
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}

          <label className={cn(emailLabelClass, "mt-3 block")}>
            Solicitante
            <input
              type="text"
              readOnly
              value={solicitante}
              className={cn(emailInputClass, "bg-slate-100")}
            />
          </label>

          <EmailGalLookupField
            className="mt-3"
            label="E-mail Dep"
            value={emailDep}
            onChange={setEmailDep}
            onToast={onToast}
          />

          <EmailGalLookupField
            className="mt-3"
            label="E-mail Gab"
            value={emailGab}
            onChange={setEmailGab}
            onToast={onToast}
          />

          {emailsContato.map((emailContato, index) => (
            <EmailGalLookupField
              key={`email-contato-${index}`}
              className="mt-3"
              label={
                emailsContato.length > 1
                  ? `E-mail Contato ${index + 1}`
                  : "E-mail Contato"
              }
              value={emailContato}
              onChange={(value) => {
                setEmailsContato((prev) => {
                  const next = [...prev];
                  next[index] = value;
                  return next;
                });
              }}
              onToast={onToast}
            />
          ))}

          <label className={cn(emailLabelClass, "mt-3 block")}>
            Contato
            <textarea
              readOnly
              rows={3}
              value={contatoTrab}
              className={cn(
                emailInputClass,
                "min-h-[4.5rem] resize-none bg-slate-100",
              )}
            />
          </label>

          <div className="mt-4 flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50/80 px-3 py-2.5 text-xs leading-relaxed text-blue-900">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>
              {isApogee
                ? "O e-mail enviado ao cliente terá o mesmo corpo e assunto recebidos na pasta Apogee."
                : htmlEdited
                  ? "Texto editado na prévia será enviado (não altera o modelo salvo)."
                  : "Prévia editável — ajustes valem só para este envio."}
              {isDeputado && nomeUsuario
                ? ` · ${normalizeText(nomeUsuario)}`
                : ""}
            </p>
          </div>
        </div>

        <div className="shrink-0 border-t border-slate-200/80 bg-white/60 px-4 py-4">
          <button
            type="button"
            disabled={sendDisabled}
            onClick={() => void handleSend()}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-secondary-blue py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-secondary-blue/90 disabled:opacity-60"
          >
            {sending || registeringAndamento ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Send className="size-4" aria-hidden />
            )}
            {registeringAndamento ? "Registrando andamento…" : "Enviar e-mail"}
          </button>
          <p className="mt-2 text-center text-[0.65rem] text-slate-400">
            Operador: ponto {ponto || "—"}
          </p>
        </div>
      </aside>

      <OsFolderBrowserModal
        row={proofFolderRow}
        open={proofFolderPickerOpen}
        onClose={() => setProofFolderPickerOpen(false)}
        mode="pick-pdf"
        onPickPdf={handleProofPdfPick}
      />
    </div>
  );
}
