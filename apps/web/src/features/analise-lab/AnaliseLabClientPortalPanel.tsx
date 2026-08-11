import { cn } from "@sagra/ui";
import {
  Eye,
  ListChecks,
  Loader2,
  Lock,
  Upload,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { ClientAnalysisItem } from "@/api/client-portal";
import { AnaliseHtmlViewer } from "@/features/analise/components/AnaliseHtmlViewer";
import {
  buildUploadedComponentSet,
  canDisregardItem,
  groupByComponente,
  groupNeedsFileUpload,
  isGroupFileUploaded,
  isItemBlockedByFileUpload,
  isItemLocked,
  isItemPending,
  itemStatusLabel,
} from "@/features/portal/portal-item-utils";

export interface AnaliseLabClientPortalPanelProps {
  osId: number;
  ano: number;
  titulo?: string | null;
  produto?: string | null;
  versaoLabel?: string | null;
  items: ClientAnalysisItem[];
  uploadedComponents: string[];
  selectedItemId: number | null;
  onSelectItem: (id: number) => void;
  clientNome: string;
  clientPonto: string;
  onClientNomeChange: (v: string) => void;
  onClientPontoChange: (v: string) => void;
  onDisregard: (item: ClientAnalysisItem) => void;
  onUploadFiles: (componente: string, files: File[]) => void;
  busy?: boolean;
  previewBanner?: string;
}

/** Painel estilo portal do cliente (lista + detalhe + identidade + upload). */
export function AnaliseLabClientPortalPanel({
  osId,
  ano,
  titulo = "",
  produto = null,
  versaoLabel = "—",
  items,
  uploadedComponents,
  selectedItemId,
  onSelectItem,
  clientNome,
  clientPonto,
  onClientNomeChange,
  onClientPontoChange,
  onDisregard,
  onUploadFiles,
  busy = false,
  previewBanner = "Prévia do portal do cliente (ações locais — não grava na API pública)",
}: AnaliseLabClientPortalPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadComponentRef = useRef<string | null>(null);
  const nomeInputRef = useRef<HTMLInputElement>(null);
  const pontoInputRef = useRef<HTMLInputElement>(null);
  const [identityHighlight, setIdentityHighlight] = useState(false);
  const [identityModalOpen, setIdentityModalOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const uploadedSet = useMemo(
    () => buildUploadedComponentSet(uploadedComponents),
    [uploadedComponents],
  );
  const grouped = useMemo(() => groupByComponente(items), [items]);
  const selectedItem = useMemo(
    () => items.find((i) => i.uniqueId === selectedItemId) ?? null,
    [items, selectedItemId],
  );

  useEffect(() => {
    if (!items.length) return;
    if (selectedItemId != null && items.some((i) => i.uniqueId === selectedItemId)) {
      return;
    }
    onSelectItem(items[0]!.uniqueId);
  }, [items, selectedItemId, onSelectItem]);

  const requireClientIdentity = (): boolean => {
    const nome = clientNome.trim();
    const ponto = clientPonto.trim();
    if (!nome || !ponto) {
      setErrorMsg("Informe seu nome e ponto antes de registrar ações.");
      setIdentityHighlight(true);
      setIdentityModalOpen(true);
      if (!nome) nomeInputRef.current?.focus();
      else pontoInputRef.current?.focus();
      return false;
    }
    setIdentityHighlight(false);
    setIdentityModalOpen(false);
    return true;
  };

  const isPortalLocked = busy || uploading;
  const uploadingComponent = uploading ? uploadComponentRef.current : null;

  const handleDisregard = (item: ClientAnalysisItem) => {
    if (isPortalLocked) return;
    if (!requireClientIdentity()) return;
    if (
      !window.confirm(
        `Desconsiderar o problema "${item.titulo}"? (Prévia local — será registrado no portal quando estiver integrado.)`,
      )
    ) {
      return;
    }
    setErrorMsg(null);
    setSuccessMsg("Item desconsiderado (prévia local).");
    onDisregard(item);
  };

  const triggerUpload = (componente: string) => {
    if (isPortalLocked) return;
    if (!requireClientIdentity()) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    uploadComponentRef.current = componente;
    fileInputRef.current?.click();
  };

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const componente = uploadComponentRef.current;
    const fileList = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = "";
    if (!fileList.length || !componente) {
      if (fileList.length && !componente) {
        setErrorMsg(
          'Não foi possível identificar o componente. Clique novamente em "Enviar arquivo".',
        );
      }
      return;
    }
    setUploading(true);
    window.setTimeout(() => {
      onUploadFiles(componente, fileList);
      setSuccessMsg(
        `Arquivo enviado (prévia local) para ${componente}. Os itens deste componente foram bloqueados.`,
      );
      setUploading(false);
    }, 400);
  };

  return (
    <aside className="relative flex w-[380px] max-w-[42vw] shrink-0 flex-col overflow-hidden border-r border-sagra-border bg-slate-50">
      <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-[10px] font-medium text-amber-900">
        {previewBanner}
      </div>

      <section className="shrink-0 border-b border-sagra-border bg-white px-3 py-2">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <label className="text-[10px] font-semibold text-slate-600">
              OS
              {produto ? (
                <span className="ml-1 rounded bg-slate-100 px-1 text-[9px] text-slate-500">
                  {produto}
                </span>
              ) : null}
            </label>
            <div className="mt-0.5 flex gap-1">
              <input
                readOnly
                value={`${osId}/${ano}`}
                className="h-8 w-[4.5rem] rounded border border-slate-200 bg-slate-100 px-1.5 text-xs font-bold"
              />
              <input
                readOnly
                value={titulo || "Sem título"}
                title={titulo || undefined}
                className="h-8 min-w-0 flex-1 truncate rounded border border-slate-200 bg-slate-100 px-1.5 text-xs"
              />
            </div>
          </div>
          <div className="w-full">
            <label className="text-[10px] font-semibold text-slate-600">
              Versão analisada
            </label>
            <input
              readOnly
              value={versaoLabel || "—"}
              className="mt-0.5 h-8 w-full rounded border border-slate-200 bg-slate-100 px-1.5 text-xs font-medium"
            />
          </div>
          <div className="min-w-[120px] flex-1">
            <label className="text-[10px] font-semibold text-slate-600">
              Seu nome
            </label>
            <input
              ref={nomeInputRef}
              value={clientNome}
              onChange={(e) => {
                onClientNomeChange(e.target.value);
                if (
                  identityHighlight &&
                  e.target.value.trim() &&
                  clientPonto.trim()
                ) {
                  setIdentityHighlight(false);
                }
              }}
              disabled={isPortalLocked}
              className={cn(
                "mt-0.5 h-8 w-full rounded border border-slate-300 px-1.5 text-xs disabled:bg-slate-100",
                identityHighlight &&
                  "border-red-500 bg-red-50 shadow-[0_0_0_2px_rgba(239,68,68,0.25)]",
              )}
              placeholder="Nome completo"
            />
          </div>
          <div className="w-20">
            <label className="text-[10px] font-semibold text-slate-600">
              Ponto
            </label>
            <input
              ref={pontoInputRef}
              value={clientPonto}
              onChange={(e) => {
                onClientPontoChange(e.target.value);
                if (
                  identityHighlight &&
                  clientNome.trim() &&
                  e.target.value.trim()
                ) {
                  setIdentityHighlight(false);
                }
              }}
              disabled={isPortalLocked}
              className={cn(
                "mt-0.5 h-8 w-full rounded border border-slate-300 px-1.5 text-xs disabled:bg-slate-100",
                identityHighlight &&
                  "border-red-500 bg-red-50 shadow-[0_0_0_2px_rgba(239,68,68,0.25)]",
              )}
              placeholder="1234"
            />
          </div>
        </div>
      </section>

      {errorMsg ? (
        <div className="shrink-0 border-b border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-900">
          {errorMsg}
        </div>
      ) : null}
      {successMsg ? (
        <div className="shrink-0 border-b border-green-200 bg-green-50 px-3 py-1.5 text-xs text-green-900">
          {successMsg}
        </div>
      ) : null}

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept=".pdf,.jpg,.jpeg,.png"
        multiple
        disabled={isPortalLocked}
        onChange={handleFileSelected}
      />

      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col",
          isPortalLocked && "pointer-events-none opacity-60",
        )}
      >
        <section className="flex min-h-0 flex-[1.2] flex-col overflow-hidden border-b border-sagra-border bg-white">
          <header className="flex shrink-0 items-center justify-between border-b border-sagra-border bg-slate-50 px-2 py-1.5 text-xs font-bold text-slate-700">
            <span className="flex items-center gap-1.5">
              <ListChecks className="size-3.5 text-secondary-blue" />
              Problemas encontrados
            </span>
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-900">
              {items.length} itens
            </span>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {items.length === 0 ? (
              <p className="p-4 text-center text-xs text-slate-500">
                Nenhum problema técnico registrado nesta análise.
              </p>
            ) : (
              Object.entries(grouped).map(([group, groupItems]) => {
                const groupBlocked =
                  uploading && uploadingComponent === group;
                const fileUploaded = isGroupFileUploaded(group, uploadedSet);
                const showUploadBtn = groupNeedsFileUpload(
                  group,
                  groupItems,
                  uploadedSet,
                );
                return (
                  <div key={group}>
                    <div className="flex flex-wrap items-center justify-between gap-1 bg-slate-200 px-2 py-1">
                      <span className="text-[9px] font-bold uppercase text-slate-600">
                        {group}
                        {groupBlocked ? " — enviando…" : ""}
                        {fileUploaded && !groupBlocked
                          ? " — arquivo enviado"
                          : ""}
                      </span>
                      {showUploadBtn ? (
                        <button
                          type="button"
                          disabled={isPortalLocked}
                          onClick={() => triggerUpload(group)}
                          className="inline-flex items-center gap-1 rounded bg-primary-green px-2 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                        >
                          {groupBlocked ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <Upload className="size-3" />
                          )}
                          Enviar arquivo ({group})
                        </button>
                      ) : null}
                    </div>
                    {groupItems.map((item) => {
                      const status = itemStatusLabel(item);
                      const pending = isItemPending(item);
                      const locked = isItemLocked(item);
                      const fileSentBlocked = isItemBlockedByFileUpload(
                        item,
                        uploadedSet,
                      );
                      const itemBlocked = Boolean(
                        groupBlocked || fileSentBlocked,
                      );
                      return (
                        <div
                          key={item.uniqueId}
                          className={cn(
                            "border-b border-slate-100",
                            selectedItemId === item.uniqueId &&
                              !itemBlocked &&
                              "border-l-[3px] border-l-blue-500 bg-blue-50",
                            !pending && "opacity-75",
                            itemBlocked && "bg-slate-100 opacity-60",
                            fileSentBlocked && "bg-green-50/60",
                          )}
                        >
                          <div className="flex items-center gap-1 px-1.5 py-1">
                            <button
                              type="button"
                              className="min-w-0 flex-1 text-left disabled:cursor-not-allowed"
                              disabled={itemBlocked}
                              onClick={() => {
                                if (!itemBlocked) onSelectItem(item.uniqueId);
                              }}
                            >
                              <div className="flex flex-wrap items-center gap-1">
                                <span className="text-xs font-semibold text-slate-800">
                                  {item.titulo || "Problema"}
                                </span>
                                {fileSentBlocked ? (
                                  <span className="rounded bg-green-600 px-1 py-0.5 text-[8px] font-bold uppercase text-white">
                                    Arquivo enviado
                                  </span>
                                ) : null}
                                {locked && pending && !fileSentBlocked ? (
                                  <span className="rounded bg-amber-400 px-1 py-0.5 text-[8px] font-bold uppercase text-black">
                                    Obrigatória
                                  </span>
                                ) : null}
                                <span className="text-[9px] text-slate-500">
                                  — {status}
                                </span>
                              </div>
                            </button>
                            {canDisregardItem(item) && !fileSentBlocked ? (
                              <button
                                type="button"
                                disabled={itemBlocked}
                                onClick={() => handleDisregard(item)}
                                className="inline-flex shrink-0 items-center gap-0.5 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[9px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                title="Desconsiderar este problema"
                              >
                                <XCircle className="size-3 text-red-600" />
                                Desconsiderar
                              </button>
                            ) : null}
                            {locked && pending && !fileSentBlocked ? (
                              <span
                                className="shrink-0 p-0.5 text-amber-600"
                                title="Resolução obrigatória"
                              >
                                <Lock className="size-3.5" />
                              </span>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-100">
          <header className="flex shrink-0 items-center gap-1.5 border-b border-sagra-border bg-slate-50 px-2 py-1.5 text-xs font-bold text-slate-700">
            <Eye className="size-3.5 text-secondary-blue" />
            Detalhe do problema
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {!selectedItem ? (
              <p className="py-8 text-center text-xs text-slate-500">
                Selecione um item na lista para visualizar.
              </p>
            ) : (
              <div className="rounded border border-slate-200 bg-white p-2 shadow-sm">
                <p className="mb-1.5 text-[10px] font-bold text-slate-500">
                  SIMULAÇÃO ({selectedItem.componenteOrigem || "Geral"}) —{" "}
                  {itemStatusLabel(selectedItem)}
                </p>
                <AnaliseHtmlViewer
                  html={selectedItem.html || ""}
                  className="rounded border border-dashed border-slate-300 bg-slate-50 p-1.5 text-xs"
                />
                <div className="mt-2 border-t border-dashed border-slate-200 pt-1.5">
                  <p className="text-[9px] font-bold text-slate-500">
                    Observação técnica
                  </p>
                  <p className="mt-0.5 rounded border-l-4 border-amber-400 bg-amber-50 px-1.5 py-1 text-xs text-amber-900">
                    {selectedItem.obs || "(Vazio)"}
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      {identityModalOpen ? (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setIdentityModalOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-lg border border-red-200 bg-white p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-sm font-bold text-slate-900">
              Identificação obrigatória
            </h2>
            <p className="mt-2 text-xs text-slate-600">
              Para continuar, informe <strong>Seu nome</strong> e{" "}
              <strong>Ponto</strong>.
            </p>
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                className="rounded bg-secondary-blue px-3 py-1.5 text-xs font-medium text-white"
                onClick={() => setIdentityModalOpen(false)}
              >
                Entendi
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
