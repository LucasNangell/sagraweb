import { cn } from "@sagra/ui";
import {
  ArrowDown,
  ArrowUp,
  Download,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  downloadSequenciaProducaoDocx,
  type SequenciaProducaoBlock,
  type SequenciaProducaoDraft,
} from "@/api/sequenciaProducao";
import { useSequenciaProducao } from "@/features/os/hooks/useSequenciaProducao";

interface OsSequenciaProducaoTabProps {
  ano: number;
  osId: number;
  readOnly: boolean;
  canEdit: boolean;
  osDirty: boolean;
}

function cloneDraft(draft: SequenciaProducaoDraft): SequenciaProducaoDraft {
  return JSON.parse(JSON.stringify(draft)) as SequenciaProducaoDraft;
}

function linesToText(lines: string[]) {
  return (lines ?? []).join("\n");
}

function textToLines(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line, index, arr) => line.trim() || index < arr.length - 1);
}

export function OsSequenciaProducaoTab({
  ano,
  osId,
  readOnly,
  canEdit,
  osDirty,
}: OsSequenciaProducaoTabProps) {
  const { query, saveMutation, regenerateMutation, createDocxMutation } =
    useSequenciaProducao(ano, osId, true);
  const [draft, setDraft] = useState<SequenciaProducaoDraft | null>(null);
  const [sequenceDirty, setSequenceDirty] = useState(false);
  const [lastDocx, setLastDocx] = useState<{
    filename: string;
    download_url: string;
  } | null>(null);

  useEffect(() => {
    if (!query.data?.draft || sequenceDirty) return;
    setDraft(cloneDraft(query.data.draft));
    setLastDocx(
      query.data.docx_filename && query.data.docx_download_url
        ? {
            filename: query.data.docx_filename,
            download_url: query.data.docx_download_url,
          }
        : null,
    );
  }, [query.data, sequenceDirty]);

  const blocks = useMemo(
    () => draft?.sections.flatMap((section) => section.blocks) ?? [],
    [draft],
  );

  const warnings = useMemo(() => {
    const all = [
      ...(draft?.warnings ?? []),
      ...blocks.flatMap((block) => block.warnings ?? []),
    ];
    return Array.from(new Set(all.filter(Boolean)));
  }, [blocks, draft?.warnings]);

  const updateBlock = (
    blockId: string,
    updater: (block: SequenciaProducaoBlock) => SequenciaProducaoBlock,
  ) => {
    if (!draft) return;
    setDraft({
      ...draft,
      confidence: "manual",
      sections: draft.sections.map((section) => ({
        ...section,
        blocks: section.blocks.map((block) =>
          block.id === blockId ? updater({ ...block }) : block,
        ),
      })),
    });
    setSequenceDirty(true);
  };

  const addBlock = () => {
    if (!draft) return;
    const nextBlock: SequenciaProducaoBlock = {
      id: `manual-${Date.now()}`,
      title: "Nova etapa",
      lines: [""],
      confidence: "manual",
      warnings: [],
    };
    setDraft({
      ...draft,
      confidence: "manual",
      sections: draft.sections.map((section, index) =>
        index === draft.sections.length - 1
          ? { ...section, blocks: [...section.blocks, nextBlock] }
          : section,
      ),
    });
    setSequenceDirty(true);
  };

  const removeBlock = (blockId: string) => {
    if (!draft) return;
    setDraft({
      ...draft,
      confidence: "manual",
      sections: draft.sections.map((section) => ({
        ...section,
        blocks: section.blocks.filter((block) => block.id !== blockId),
      })),
    });
    setSequenceDirty(true);
  };

  const moveBlock = (blockId: string, direction: -1 | 1) => {
    if (!draft) return;
    setDraft({
      ...draft,
      confidence: "manual",
      sections: draft.sections.map((section) => {
        const index = section.blocks.findIndex((block) => block.id === blockId);
        const target = index + direction;
        if (index < 0 || target < 0 || target >= section.blocks.length) {
          return section;
        }
        const nextBlocks = [...section.blocks];
        const [block] = nextBlocks.splice(index, 1);
        nextBlocks.splice(target, 0, block);
        return { ...section, blocks: nextBlocks };
      }),
    });
    setSequenceDirty(true);
  };

  const handleSave = async () => {
    if (!draft) return;
    const result = await saveMutation.mutateAsync(draft);
    setDraft(cloneDraft(result.draft));
    setSequenceDirty(false);
  };

  const handleRegenerate = async () => {
    if (sequenceDirty && !window.confirm("Descartar ajustes da sequência e recalcular?")) {
      return;
    }
    const result = await regenerateMutation.mutateAsync();
    setDraft(cloneDraft(result.draft));
    setSequenceDirty(false);
  };

  const handleCreateDocx = async () => {
    if (!draft) return;
    const result = await createDocxMutation.mutateAsync(draft);
    setLastDocx({ filename: result.filename, download_url: result.download_url });
    setSequenceDirty(false);
    window.alert(`DOCX criado na pasta Sefoc: ${result.filename}`);
  };

  const handleDownload = async () => {
    if (!lastDocx) return;
    await downloadSequenciaProducaoDocx(lastDocx.download_url, lastDocx.filename);
  };

  if (query.error) {
    return (
      <p className="py-8 text-center text-sm text-red-600">
        {query.error instanceof Error
          ? query.error.message
          : "Erro ao carregar sequência de produção."}
      </p>
    );
  }

  if (query.isLoading || !draft) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-neutral-500">
        <Loader2 className="size-5 animate-spin" aria-hidden />
        Montando sequência de produção...
      </div>
    );
  }

  const disabled = readOnly || !canEdit;
  const canCreateDocx =
    canEdit &&
    !osDirty &&
    !query.data?.source_changed &&
    !saveMutation.isPending &&
    !createDocxMutation.isPending &&
    !regenerateMutation.isPending;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2">
        <div className="min-w-0 flex-1 text-xs text-slate-600">
          <span className="font-semibold text-secondary-blue">
            OS {draft.os.numero}/{draft.os.ano}
          </span>
          {draft.os.produto ? <span> · {draft.os.produto}</span> : null}
          {draft.os.formato ? <span> · {draft.os.formato}</span> : null}
          {query.data?.source_changed ? (
            <span className="ml-2 font-semibold text-amber-700">
              Dados da OS mudaram desde o último rascunho.
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={handleRegenerate}
          disabled={disabled || regenerateMutation.isPending}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
        >
          {regenerateMutation.isPending ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="size-3.5" aria-hidden />
          )}
          Recalcular
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={disabled || !sequenceDirty || saveMutation.isPending}
          className="inline-flex items-center gap-1.5 rounded-md border border-secondary-blue/30 bg-white px-2.5 py-1.5 text-xs font-semibold text-secondary-blue shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
        >
          {saveMutation.isPending ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <Save className="size-3.5" aria-hidden />
          )}
          Salvar rascunho
        </button>
        {lastDocx ? (
          <button
            type="button"
            onClick={() => void handleDownload()}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            <Download className="size-3.5" aria-hidden />
            Baixar docx
          </button>
        ) : null}
        <button
          type="button"
          onClick={handleCreateDocx}
          disabled={!canCreateDocx}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary-green px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-primary-green/90 disabled:opacity-50"
        >
          {createDocxMutation.isPending ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <FileText className="size-3.5" aria-hidden />
          )}
          Criar docx
        </button>
      </div>

      {osDirty ? (
        <p className="shrink-0 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
          Salve as alterações da OS antes de criar o DOCX para que a sequência use
          os dados atualizados.
        </p>
      ) : null}

      {warnings.length ? (
        <div className="shrink-0 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <p className="font-semibold">Conferir antes de gerar:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto pr-1 [scrollbar-gutter:stable]">
        <div className="space-y-3">
          {blocks.map((block, index) => (
            <section
              key={block.id}
              className="rounded-md border border-slate-200 bg-white shadow-sm"
            >
              <header className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/80 px-3 py-2">
                <input
                  value={block.title}
                  disabled={disabled}
                  onChange={(event) =>
                    updateBlock(block.id, (current) => ({
                      ...current,
                      title: event.target.value,
                      confidence: "manual",
                    }))
                  }
                  className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm font-bold text-secondary-blue outline-none focus:border-secondary-blue/30 focus:bg-white disabled:cursor-not-allowed"
                />
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[0.65rem] font-semibold uppercase",
                    block.confidence === "manual"
                      ? "bg-blue-50 text-blue-700"
                      : block.confidence === "review"
                        ? "bg-amber-100 text-amber-800"
                        : "bg-slate-100 text-slate-600",
                  )}
                >
                  {block.confidence === "manual"
                    ? "editado"
                    : block.confidence === "review"
                      ? "revisar"
                      : "auto"}
                </span>
                <button
                  type="button"
                  title="Subir etapa"
                  onClick={() => moveBlock(block.id, -1)}
                  disabled={disabled || index === 0}
                  className="rounded-md p-1 text-slate-500 hover:bg-white hover:text-secondary-blue disabled:opacity-40"
                >
                  <ArrowUp className="size-4" aria-hidden />
                </button>
                <button
                  type="button"
                  title="Descer etapa"
                  onClick={() => moveBlock(block.id, 1)}
                  disabled={disabled || index === blocks.length - 1}
                  className="rounded-md p-1 text-slate-500 hover:bg-white hover:text-secondary-blue disabled:opacity-40"
                >
                  <ArrowDown className="size-4" aria-hidden />
                </button>
                <button
                  type="button"
                  title="Remover etapa"
                  onClick={() => removeBlock(block.id)}
                  disabled={disabled}
                  className="rounded-md p-1 text-slate-500 hover:bg-white hover:text-red-600 disabled:opacity-40"
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </header>
              <textarea
                value={linesToText(block.lines)}
                disabled={disabled}
                onChange={(event) =>
                  updateBlock(block.id, (current) => ({
                    ...current,
                    lines: textToLines(event.target.value),
                    confidence: "manual",
                  }))
                }
                rows={Math.max(3, Math.min(10, block.lines.length + 1))}
                className="block w-full resize-y border-0 bg-white px-3 py-2 text-sm leading-6 text-slate-800 outline-none focus:ring-2 focus:ring-inset focus:ring-secondary-blue/20 disabled:cursor-not-allowed disabled:bg-slate-100"
              />
            </section>
          ))}
        </div>
        <button
          type="button"
          onClick={addBlock}
          disabled={disabled}
          className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-dashed border-secondary-blue/40 bg-white px-3 py-2 text-xs font-semibold text-secondary-blue shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
        >
          <Plus className="size-3.5" aria-hidden />
          Adicionar etapa
        </button>
      </div>
    </div>
  );
}
