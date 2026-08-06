import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { cn } from "@sagra/ui";

import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  ListChecks,
  Loader2,
  Lock,
  Upload,
  XCircle,
} from "lucide-react";

import type { ReactNode } from "react";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  type ClientAnalysisItem,
  clientDesconsiderarItem,
  clientUploadFilesSmart,
  fetchClientAnalysis,
} from "@/api/client-portal";
import { queryKeys } from "@/api/query-keys";
import { PortalSystemHeader } from "@/components/portal/PortalSystemHeader";
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
} from "./portal-item-utils";

interface PortalPtPageProps {
  token: string;
  osId: number;
  ano: number;
  /** Modo embutido no portal autenticado `/cliente` (sem header DEAPA duplicado). */
  embedded?: boolean;
  onBack?: () => void;
}

function PortalPtFrame({
  embedded,
  onBack,
  children,
  className,
}: {
  embedded?: boolean;
  onBack?: () => void;
  children: ReactNode;
  className?: string;
}) {
  if (!embedded) {
    return (
      <div className={cn("flex min-h-screen flex-col bg-slate-100", className)}>{children}</div>
    );
  }
  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl border border-sagra-border bg-slate-50 shadow-sm",
        className,
      )}
    >
      {onBack ? (
        <div className="border-b border-sagra-border/70 bg-white px-4 py-2">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm font-medium text-secondary-blue hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary-blue"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Voltar ao painel
          </button>
        </div>
      ) : null}
      {children}
    </div>
  );
}

export function PortalPtPage({ token, osId, ano, embedded, onBack }: PortalPtPageProps) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadComponentRef = useRef<string | null>(null);
  const nomeInputRef = useRef<HTMLInputElement>(null);
  const pontoInputRef = useRef<HTMLInputElement>(null);

  const [clientNome, setClientNome] = useState("");
  const [clientPonto, setClientPonto] = useState("");
  const [identityHighlight, setIdentityHighlight] = useState(false);
  const [identityModalOpen, setIdentityModalOpen] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);

  const analysisQuery = useQuery({
    queryKey: queryKeys.portal.pt(token, osId, ano),
    queryFn: () => fetchClientAnalysis(ano, osId, token),
    enabled: Boolean(token && osId && ano),
  });

  const items = analysisQuery.data?.items ?? [];

  const selectedItem = useMemo(
    () => items.find((i) => i.uniqueId === selectedItemId) ?? null,
    [items, selectedItemId],
  );

  const grouped = useMemo(() => groupByComponente(items), [items]);

  const uploadedComponents = useMemo(
    () => buildUploadedComponentSet(analysisQuery.data?.componentesEnviados),
    [analysisQuery.data?.componentesEnviados],
  );

  const portalComplete = Boolean(analysisQuery.data?.portalComplete);

  useEffect(() => {
    if (!items.length) {
      setSelectedItemId(null);
      return;
    }
    if (selectedItemId != null && items.some((i) => i.uniqueId === selectedItemId)) {
      return;
    }
    setSelectedItemId(items[0].uniqueId);
  }, [items, selectedItemId]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: queryKeys.portal.pt(token, osId, ano) });
  };

  const disregardMutation = useMutation({
    mutationFn: clientDesconsiderarItem,
    onSuccess: (data) => {
      setErrorMsg(null);
      setSuccessMsg(
        data.moved
          ? "Item desconsiderado. Todos os itens foram tratados — OS em execução."
          : "Item desconsiderado com sucesso.",
      );
      invalidate();
    },
    onError: (err) => {
      setSuccessMsg(null);
      setErrorMsg(
        err instanceof Error ? err.message : "Não foi possível desconsiderar o item.",
      );
    },
  });

  const uploadMutation = useMutation({
    mutationFn: (args: {
      osId: number;
      ano: number;
      ponto: string;
      token: string;
      componente: string;
      files: File[];
    }) => clientUploadFilesSmart(args),
    onSuccess: (data) => {
      setErrorMsg(null);
      if (data.portalComplete) {
        setSuccessMsg(null);
      } else {
        const comp = data.componente ?? uploadComponentRef.current ?? "componente";
        setSuccessMsg(
          `Arquivo enviado com sucesso para ${comp}. Os itens deste componente foram bloqueados — envie os demais arquivos pendentes.`,
        );
      }
      invalidate();
    },
    onError: (err) => {
      setSuccessMsg(null);
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "Falha ao enviar o(s) arquivo(s). Verifique a conexão e tente novamente.",
      );
    },
  });

  const isUploading = uploadMutation.isPending;
  const uploadingComponent = isUploading ? uploadComponentRef.current : null;

  const isGroupBlocked = (group: string) =>
    isUploading && uploadingComponent === group;

  const isPortalLocked = isUploading || disregardMutation.isPending;

  const requireClientIdentity = (): boolean => {
    const nome = clientNome.trim();
    const ponto = clientPonto.trim();
    if (!nome || !ponto) {
      setErrorMsg("Informe seu nome e ponto antes de registrar ações.");
      setIdentityHighlight(true);
      setIdentityModalOpen(true);
      if (!nome) {
        nomeInputRef.current?.focus();
      } else {
        pontoInputRef.current?.focus();
      }
      return false;
    }
    setIdentityHighlight(false);
    setIdentityModalOpen(false);
    return true;
  };

  const handleDisregard = (item: ClientAnalysisItem) => {
    if (isPortalLocked) return;
    if (!requireClientIdentity()) return;
    if (
      !window.confirm(
        `Desconsiderar o problema "${item.titulo}"? Esta ação será registrada no sistema.`,
      )
    ) {
      return;
    }
    setErrorMsg(null);
    disregardMutation.mutate({
      id_item: item.uniqueId,
      nome_cliente: clientNome.trim(),
      ponto: clientPonto.trim(),
      os_id: osId,
      ano,
    });
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
    // Copiar antes de limpar o input: FileList é viva e fica vazia ao resetar value.
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

    uploadMutation.mutate({
      osId,
      ano,
      ponto: clientPonto.trim(),
      token,
      componente,
      files: fileList,
    });
  };

  if (!osId || !ano || !token) {
    return (
      <PortalError message="Link inválido. Parâmetros os, ano e token são obrigatórios." />
    );
  }

  if (analysisQuery.isLoading) {
    return (
      <PortalPtFrame embedded={embedded} onBack={onBack}>
        {!embedded ? <PortalSystemHeader /> : null}
        <PortalLoading label="Carregando problemas técnicos…" />
      </PortalPtFrame>
    );
  }

  if (analysisQuery.isError) {
    return (
      <PortalPtFrame embedded={embedded} onBack={onBack}>
        {!embedded ? <PortalSystemHeader /> : null}
        <PortalError
          message={
            analysisQuery.error instanceof Error
              ? analysisQuery.error.message
              : "Não foi possível carregar a análise."
          }
        />
      </PortalPtFrame>
    );
  }

  const data = analysisQuery.data;
  const titulo = data?.osTitulo ?? "Sem título";
  const versaoLabel = data?.versaoLabel || data?.versao || "—";

  if (portalComplete) {
    return (
      <PortalPtFrame embedded={embedded} onBack={onBack}>
        {!embedded ? <PortalSystemHeader /> : null}
        <PortalUploadComplete osLabel={`${osId}/${ano}`} titulo={titulo} />
      </PortalPtFrame>
    );
  }

  return (
    <PortalPtFrame
      embedded={embedded}
      onBack={onBack}
      className={embedded ? undefined : "relative h-screen min-h-0"}
    >
      {!embedded ? <PortalSystemHeader /> : null}

      {isUploading ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          role="alertdialog"
          aria-busy="true"
          aria-label="Enviando arquivos"
        >
          <div className="flex max-w-sm flex-col items-center gap-3 rounded-lg border border-sagra-border bg-white px-6 py-5 shadow-xl">
            <Loader2 className="size-10 animate-spin text-primary-green" />
            <p className="text-center text-sm font-semibold text-slate-800">
              Enviando arquivo(s) — {uploadingComponent ?? "componente"}
            </p>
            <p className="text-center text-xs text-slate-500">
              Aguarde a confirmação. Os itens deste componente estão bloqueados até
              concluir.
            </p>
          </div>
        </div>
      ) : null}

      {identityModalOpen ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="identity-modal-title"
          aria-describedby="identity-modal-desc"
          onClick={() => setIdentityModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-lg border border-red-200 bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="identity-modal-title" className="text-base font-bold text-slate-900">
              Identificação obrigatória
            </h2>
            <p id="identity-modal-desc" className="mt-2 text-sm text-slate-600">
              Para continuar, informe <strong>Seu nome</strong> e <strong>Ponto</strong>.
              Esses campos já foram destacados no topo da página.
            </p>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                className="rounded bg-secondary-blue px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
                onClick={() => setIdentityModalOpen(false)}
                autoFocus
              >
                Entendi
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <section
        className={cn(
          "shrink-0 border-b border-sagra-border bg-white px-4 py-3 shadow-sm",
          embedded ? "border-t border-t-primary-green/30" : "border-t-[3px] border-t-primary-green",
        )}
      >
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-end gap-3">
          <div className="min-w-[140px] flex-[2]">
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
              {embedded ? "Ordem de serviço" : "OS selecionada"}
              {data?.osProduto ? (
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                  {data.osProduto}
                </span>
              ) : null}
            </label>
            <div className="mt-1 flex gap-2">
              <input
                readOnly
                value={`${osId}/${ano}`}
                className="h-9 w-24 rounded border border-slate-200 bg-slate-100 px-2 text-sm font-bold text-slate-900"
              />
              <input
                readOnly
                value={titulo}
                className="h-9 min-w-0 flex-1 rounded border border-slate-200 bg-slate-100 px-2 text-sm text-slate-900"
              />
            </div>
          </div>
          <div className="min-w-[160px] flex-1">
            <label className="text-xs font-semibold text-slate-600">Versão analisada</label>
            <input
              readOnly
              value={versaoLabel}
              title={versaoLabel}
              className="mt-1 h-9 w-full rounded border border-slate-200 bg-slate-100 px-2 text-sm font-medium text-slate-900"
            />
          </div>
          <div className="min-w-[120px]">
            <label className="text-xs font-semibold text-slate-600">Seu nome</label>
            <input
              ref={nomeInputRef}
              value={clientNome}
              onChange={(e) => {
                const value = e.target.value;
                setClientNome(value);
                if (identityHighlight && value.trim() && clientPonto.trim()) {
                  setIdentityHighlight(false);
                }
              }}
              disabled={isPortalLocked}
              className={cn(
                "mt-1 h-9 w-full min-w-[140px] rounded border border-slate-300 px-2 text-sm text-slate-900 disabled:bg-slate-100",
                identityHighlight &&
                  "border-red-500 bg-red-50 shadow-[0_0_0_2px_rgba(239,68,68,0.25)]",
              )}
              placeholder="Nome completo"
            />
          </div>
          <div className="min-w-[90px]">
            <label className="text-xs font-semibold text-slate-600">Ponto</label>
            <input
              ref={pontoInputRef}
              value={clientPonto}
              onChange={(e) => {
                const value = e.target.value;
                setClientPonto(value);
                if (identityHighlight && clientNome.trim() && value.trim()) {
                  setIdentityHighlight(false);
                }
              }}
              disabled={isPortalLocked}
              className={cn(
                "mt-1 h-9 w-24 rounded border border-slate-300 px-2 text-sm text-slate-900 disabled:bg-slate-100",
                identityHighlight &&
                  "border-red-500 bg-red-50 shadow-[0_0_0_2px_rgba(239,68,68,0.25)]",
              )}
              placeholder="1234"
            />
          </div>
        </div>
      </section>

      {errorMsg ? (
        <div className="shrink-0 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-900">
          {errorMsg}
        </div>
      ) : null}

      {successMsg ? (
        <div className="shrink-0 border-b border-green-200 bg-green-50 px-4 py-2 text-sm text-green-900">
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
          "mx-auto grid min-h-0 w-full max-w-[1400px] flex-1 gap-2 p-2 lg:grid-cols-[minmax(280px,1fr)_minmax(320px,1.4fr)]",
          isPortalLocked && "pointer-events-none opacity-60",
        )}
      >
        <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-sagra-border bg-white shadow-sm">
          <header className="flex shrink-0 items-center justify-between border-b border-sagra-border bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700">
            <span className="flex items-center gap-2">
              <ListChecks className="size-4 text-secondary-blue" />
              Problemas encontrados
            </span>
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">
              {items.length} itens
            </span>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {items.length === 0 ? (
              <p className="p-6 text-center text-sm text-slate-500">
                Nenhum problema técnico registrado nesta análise.
              </p>
            ) : (
              Object.entries(grouped).map(([group, groupItems]) => {
                const groupBlocked = isGroupBlocked(group);
                const fileUploaded = isGroupFileUploaded(group, uploadedComponents);
                const showUploadBtn = groupNeedsFileUpload(
                  group,
                  groupItems,
                  uploadedComponents,
                );
                return (
                  <div key={group}>
                    <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-200 px-3 py-1.5">
                      <span className="text-[10px] font-bold uppercase text-slate-600">
                        {group}
                        {groupBlocked ? " — enviando arquivo…" : ""}
                        {fileUploaded && !groupBlocked ? " — arquivo enviado" : ""}
                      </span>
                      {showUploadBtn ? (
                        <button
                          type="button"
                          disabled={isPortalLocked}
                          onClick={() => triggerUpload(group)}
                          className="inline-flex items-center gap-1 rounded bg-primary-green px-2 py-1 text-[10px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
                        >
                          {groupBlocked ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <Upload className="size-3" />
                          )}
                          Enviar arquivo corrigido ({group})
                        </button>
                      ) : null}
                    </div>

                    {groupItems.map((item) => {
                      const status = itemStatusLabel(item);
                      const pending = isItemPending(item);
                      const locked = isItemLocked(item);
                      const fileSentBlocked = isItemBlockedByFileUpload(
                        item,
                        uploadedComponents,
                      );
                      const itemBlocked = groupBlocked || fileSentBlocked;
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
                          <div className="flex items-center gap-1 px-2 py-1.5">
                            <button
                              type="button"
                              className="min-w-0 flex-1 text-left disabled:cursor-not-allowed"
                              disabled={itemBlocked}
                              onClick={() => {
                                if (!itemBlocked) setSelectedItemId(item.uniqueId);
                              }}
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-semibold text-slate-800">
                                  {item.titulo || "Problema"}
                                </span>
                                {fileSentBlocked ? (
                                  <span
                                    className="rounded bg-green-600 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white"
                                    title="Arquivo corrigido já enviado para este componente"
                                  >
                                    Arquivo enviado
                                  </span>
                                ) : null}
                                {locked && pending && !fileSentBlocked ? (
                                  <span
                                    className="rounded bg-amber-400 px-1.5 py-0.5 text-[9px] font-bold uppercase text-black"
                                    title="Resolução obrigatória — não pode desconsiderar"
                                  >
                                    Obrigatória
                                  </span>
                                ) : null}
                                <span className="text-[10px] text-slate-500">— {status}</span>
                              </div>
                            </button>

                            {canDisregardItem(item) && !fileSentBlocked ? (
                              <button
                                type="button"
                                disabled={itemBlocked || disregardMutation.isPending}
                                onClick={() => handleDisregard(item)}
                                className="inline-flex shrink-0 items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                title="Desconsiderar este problema"
                              >
                                <XCircle className="size-3.5 text-red-600" />
                                Desconsiderar
                              </button>
                            ) : null}

                            {locked && pending && !fileSentBlocked ? (
                              <span
                                className="shrink-0 rounded p-1 text-amber-600"
                                title="Resolução obrigatória (cadeado)"
                              >
                                <Lock className="size-4" />
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

        <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-sagra-border bg-slate-100 shadow-sm">
          <header className="flex shrink-0 items-center gap-2 border-b border-sagra-border bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700">
            <Eye className="size-4 text-secondary-blue" />
            Detalhe do problema
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {!selectedItem ? (
              <p className="py-12 text-center text-sm text-slate-500">
                Selecione um item na lista para visualizar.
              </p>
            ) : (
              <div className="rounded border border-slate-200 bg-white p-3 shadow-sm">
                <p className="mb-2 text-xs font-bold text-slate-500">
                  SIMULAÇÃO ({selectedItem.componenteOrigem || "Geral"}) —{" "}
                  {itemStatusLabel(selectedItem)}
                </p>
                <AnaliseHtmlViewer
                  html={selectedItem.html || ""}
                  className="rounded border border-dashed border-slate-300 bg-slate-50 p-2 text-sm"
                />
                <div className="mt-4 border-t border-dashed border-slate-200 pt-2">
                  <p className="text-[10px] font-bold text-slate-500">Observação técnica</p>
                  <p className="mt-1 rounded border-l-4 border-amber-400 bg-amber-50 px-2 py-1 text-sm text-amber-900">
                    {selectedItem.obs || "(Vazio)"}
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </PortalPtFrame>
  );
}

function PortalLoading({ label }: { label: string }) {
  return (
    <div className="flex flex-1 items-center justify-center text-neutral-500">
      <Loader2 className="mr-2 size-6 animate-spin" />
      {label}
    </div>
  );
}

function PortalError({ message }: { message: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <div className="max-w-md rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-900">
        {message}
      </div>
    </div>
  );
}

function PortalUploadComplete({
  osLabel,
  titulo,
}: {
  osLabel: string;
  titulo: string;
}) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="max-w-lg rounded-xl border border-green-200 bg-white px-8 py-10 text-center shadow-lg">
        <CheckCircle2 className="mx-auto size-14 text-primary-green" aria-hidden />
        <h1 className="mt-4 text-xl font-bold text-slate-900">
          Arquivo(s) enviado(s) com sucesso
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          O material da OS <strong>{osLabel}</strong>
          {titulo ? (
            <>
              {" "}
              (<span className="font-medium">{titulo}</span>)
            </>
          ) : null}{" "}
          foi recebido e seguirá para análise pela equipe técnica.
        </p>
        <p className="mt-4 text-xs text-slate-500">
          Você pode fechar esta página. Em caso de dúvidas, entre em contato com o setor
          responsável.
        </p>
      </div>
    </div>
  );
}
