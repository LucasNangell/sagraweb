import { Loader2 } from "lucide-react";

import { EmailHtmlVisualEditor } from "@/features/email/components/editor/EmailHtmlVisualEditor";
import { EmailHtmlViewer } from "@/features/email/components/EmailHtmlViewer";

export function EmailLivePreviewPanel({
  subject,
  html,
  loading = false,
  emptyMessage = "Selecione um modelo ou edite o HTML para ver a prévia.",
  editable = false,
  onHtmlChange,
  onFocusChange,
}: {
  subject?: string;
  html?: string;
  loading?: boolean;
  emptyMessage?: string;
  editable?: boolean;
  onHtmlChange?: (html: string) => void;
  onFocusChange?: (focused: boolean) => void;
}) {
  const hasContent = Boolean(html?.trim());
  const canEdit = editable && Boolean(onHtmlChange) && hasContent;

  return (
    <div className="email-admin-col rounded border border-slate-200">
      <p className="shrink-0 border-b border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        Pré-visualização
        {canEdit ? (
          <span className="ml-2 font-normal normal-case text-slate-400">
            — editor visual: formatação, imagens (arrastar/soltar) e réguas de coluna
          </span>
        ) : null}
        {loading ? (
          <Loader2 className="ml-2 inline size-3 animate-spin text-slate-400" aria-hidden />
        ) : null}
      </p>
      <div className="email-admin-preview-panel p-3">
        {subject?.trim() ? (
          <p className="mb-2 border-b border-slate-100 pb-2 text-xs leading-snug text-slate-700">
            <span className="font-semibold text-slate-500">Assunto: </span>
            {subject}
          </p>
        ) : null}
        {hasContent ? (
          canEdit ? (
            <EmailHtmlVisualEditor
              html={html!}
              onHtmlChange={onHtmlChange!}
              onFocusChange={onFocusChange}
            />
          ) : (
            <div className="rounded border border-slate-100 bg-white p-2">
              <EmailHtmlViewer html={html!} />
            </div>
          )
        ) : (
          <div className="flex h-full min-h-[12rem] items-center justify-center text-center text-xs text-slate-500">
            {emptyMessage}
          </div>
        )}
      </div>
    </div>
  );
}
