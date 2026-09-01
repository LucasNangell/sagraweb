import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type {
  CredenciaisDepolModelo,
  CredenciaisDepolPedido,
} from "@/api/credenciais-depol";
import {
  CredenciaisDepolLivePreview,
  textoToLinhas,
} from "@/features/credenciais-depol/components/CredenciaisDepolLivePreview";
import {
  clearDepolPedidoDraft,
  loadDepolPedidoDraft,
  normalizeDepolPedidoDraft,
  resolveHydratedDepolDraft,
  saveDepolPedidoDraft,
  type CredenciaisDepolDraftItem,
} from "@/features/credenciais-depol/depolPedidoDraftStorage";

export type CredenciaisDepolPedidoAdapters = {
  queryKey: readonly unknown[];
  fetchModelos: () => Promise<{ modelos: CredenciaisDepolModelo[] }>;
  createPedido: (body: {
    itens: Array<{
      ordem: number;
      modelo_arquivo: string;
      linha1: string;
      linha2?: string;
      linha3?: string;
    }>;
  }) => Promise<CredenciaisDepolPedido | { id: number; itens: unknown[] }>;
  thumbUrl: (nome: string) => string;
  /** @deprecated Prévia ao vivo removida; mantido opcional por compat. */
  svgUrl?: (nome: string) => string;
  /** Chave localStorage do rascunho (staff vs cliente). */
  draftStorageKey: string;
  /** Substitui o load inicial (ex.: migrar chave antiga do cliente). */
  loadDraft?: () => CredenciaisDepolDraftItem[];
  /** Rascunho na conta (portal cliente) — sobrevive a outro navegador. */
  fetchRemoteDraft?: () => Promise<{ itens: unknown }>;
  saveRemoteDraft?: (items: CredenciaisDepolDraftItem[]) => Promise<unknown>;
  persistHint?: string;
  emptyModelosHint?: string;
  invalidateKeys?: readonly (readonly unknown[])[];
};

function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}

export function CredenciaisDepolPedidoPanel({
  adapters,
  onSubmitted,
}: {
  adapters: CredenciaisDepolPedidoAdapters;
  onSubmitted?: (pedido: { id: number }) => void;
}) {
  const qc = useQueryClient();
  const draftKey = adapters.draftStorageKey;
  const fetchRemoteDraft = adapters.fetchRemoteDraft;
  const saveRemoteDraft = adapters.saveRemoteDraft;
  const [selectedModelo, setSelectedModelo] = useState<string | null>(null);
  const [textoLinhas, setTextoLinhas] = useState("");
  const [draft, setDraft] = useState<CredenciaisDepolDraftItem[]>(() =>
    adapters.loadDraft ? adapters.loadDraft() : loadDepolPedidoDraft(draftKey),
  );
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const hydratedRef = useRef(!fetchRemoteDraft);
  const dirtyRef = useRef(false);

  useEffect(() => {
    saveDepolPedidoDraft(draftKey, draft);
    if (!hydratedRef.current || !saveRemoteDraft) return;
    void saveRemoteDraft(draft);
  }, [draft, draftKey, saveRemoteDraft]);

  useEffect(() => {
    if (!fetchRemoteDraft) {
      hydratedRef.current = true;
      return;
    }
    let cancelled = false;
    hydratedRef.current = false;
    void fetchRemoteDraft()
      .then((res) => {
        if (cancelled) return;
        const remote = normalizeDepolPedidoDraft(res.itens);
        if (dirtyRef.current) {
          hydratedRef.current = true;
          void saveRemoteDraft?.(draftRef.current);
          return;
        }
        const resolved = resolveHydratedDepolDraft(
          loadDepolPedidoDraft(draftKey),
          remote,
        );
        const same =
          JSON.stringify(draftRef.current) === JSON.stringify(resolved.items);
        if (!same) {
          setDraft(resolved.items);
        }
        saveDepolPedidoDraft(draftKey, resolved.items);
        if (resolved.shouldPushLocalToRemote) {
          void saveRemoteDraft?.(resolved.items);
        }
        hydratedRef.current = true;
      })
      .catch(() => {
        if (!cancelled) hydratedRef.current = true;
      });
    return () => {
      cancelled = true;
      if (hydratedRef.current && saveRemoteDraft) {
        void saveRemoteDraft(draftRef.current);
      }
    };
  }, [draftKey, fetchRemoteDraft, saveRemoteDraft]);

  const modelosQ = useQuery({
    queryKey: adapters.queryKey,
    queryFn: adapters.fetchModelos,
  });

  const parsedLinhas = useMemo(() => textoToLinhas(textoLinhas), [textoLinhas]);
  const { linha1, linha2, linha3, extraLines } = parsedLinhas;

  const createMut = useMutation({
    mutationFn: adapters.createPedido,
    onSuccess: (pedido) => {
      dirtyRef.current = false;
      setDraft([]);
      clearDepolPedidoDraft(draftKey);
      void saveRemoteDraft?.([]);
      setSelectedModelo(null);
      setTextoLinhas("");
      setError(null);
      const nItens = Array.isArray(pedido.itens) ? pedido.itens.length : 0;
      setOkMsg(
        pedido.nro_protocolo && pedido.ano_protocolo
          ? `Pedido #${pedido.id} criado e vinculado à OS ${pedido.nro_protocolo}/${pedido.ano_protocolo}.`
          : `Pedido #${pedido.id} criado com ${nItens} credencial(is).`,
      );
      for (const key of adapters.invalidateKeys ?? [adapters.queryKey]) {
        void qc.invalidateQueries({ queryKey: [...key] });
      }
      onSubmitted?.(pedido);
    },
    onError: (err: Error) => setError(err.message || "Falha ao criar pedido"),
  });

  const modelos = modelosQ.data?.modelos ?? [];
  const selectedModeloObj: CredenciaisDepolModelo | undefined = modelos.find(
    (m) => m.nome === selectedModelo || m.arquivo_jpg === selectedModelo,
  );

  function addToDraft() {
    setError(null);
    if (!selectedModelo) {
      setError("Selecione um modelo.");
      return;
    }
    if (!linha1.trim()) {
      setError("A primeira linha é obrigatória.");
      return;
    }
    if (linha3.trim() && !linha2.trim()) {
      setError("Informe a linha 2 antes da linha 3 (não deixe linha em branco no meio).");
      return;
    }
    if (extraLines > 0) {
      setError("Use no máximo 3 linhas (Enter separa as linhas).");
      return;
    }
    dirtyRef.current = true;
    setDraft((prev) => [
      ...prev,
      {
        key: `${Date.now()}-${prev.length}`,
        modelo_arquivo: selectedModelo,
        linha1: linha1.trim(),
        linha2: linha2.trim(),
        linha3: linha3.trim(),
      },
    ]);
    setTextoLinhas("");
  }

  function submitPedido() {
    setError(null);
    setOkMsg(null);
    if (!draft.length) {
      setError("Inclua ao menos uma credencial no pedido.");
      return;
    }
    createMut.mutate({
      itens: draft.map((d, i) => ({
        ordem: i + 1,
        modelo_arquivo: d.modelo_arquivo,
        linha1: d.linha1,
        linha2: d.linha2 || undefined,
        linha3: d.linha3 || undefined,
      })),
    });
  }

  return (
    <div className="mx-auto grid w-full max-w-7xl gap-4 p-1 pb-6 lg:grid-cols-3">
      <Panel className="p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Modelos
        </h2>
        {modelosQ.isLoading ? (
          <p className="mt-3 flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="size-4 animate-spin" /> Carregando…
          </p>
        ) : modelosQ.isError ? (
          <p className="mt-3 text-sm text-red-600">
            {(modelosQ.error as Error).message || "Erro ao listar modelos"}
          </p>
        ) : !modelos.length ? (
          <p className="mt-3 text-sm text-slate-500">
            {adapters.emptyModelosHint ??
              "Nenhum modelo ativo. Em Configurações → Credenciais DEPOL, sincronize a pasta e ative os modelos."}
          </p>
        ) : (
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4">
            {modelos.map((m) => {
              const arquivo = m.arquivo_jpg || m.nome;
              const active = selectedModelo === arquivo;
              return (
                <button
                  key={arquivo}
                  type="button"
                  onClick={() => setSelectedModelo(arquivo)}
                  className={`overflow-hidden rounded-md border text-left transition ${
                    active
                      ? "border-emerald-600 ring-2 ring-emerald-500/40 shadow-md"
                      : "border-slate-200 hover:border-slate-400"
                  }`}
                >
                  <img
                    src={adapters.thumbUrl(arquivo)}
                    alt={m.nome_exibicao || arquivo}
                    className="h-20 w-full object-cover bg-slate-100 sm:h-24"
                  />
                  <span className="block truncate px-1.5 py-1 text-[10px] leading-tight text-slate-700">
                    {m.nome_exibicao || arquivo}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </Panel>

      <Panel className="flex flex-col p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Prévia
        </h2>
        {selectedModelo ? (
          <div className="mt-3 flex flex-col items-center gap-3">
            <div className="w-full max-w-[220px] overflow-hidden rounded-lg border-2 border-emerald-600 shadow-md ring-2 ring-emerald-500/30">
              <CredenciaisDepolLivePreview
                modeloArquivo={selectedModelo}
                layout={selectedModeloObj?.layout}
                resolveThumbUrl={adapters.thumbUrl}
              />
            </div>
            <p className="text-center text-sm font-medium text-slate-800">
              {selectedModeloObj?.nome_exibicao || selectedModelo}
            </p>
          </div>
        ) : (
          <p className="mt-3 rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-8 text-center text-sm text-slate-500">
            Selecione um modelo à esquerda
          </p>
        )}

        <h2 className="mt-5 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Dados da credencial
        </h2>

        <div className="mt-3 grid gap-3">
          <label className="grid gap-1 text-sm">
            <span className="text-slate-600">Texto</span>
            <textarea
              className="min-h-[6.5rem] rounded-md border border-slate-300 px-3 py-2 font-sans leading-relaxed"
              value={textoLinhas}
              onChange={(e) => setTextoLinhas(e.target.value)}
              placeholder={"Linha 1\nLinha 2\nLinha 3"}
              rows={4}
            />
          </label>
          {extraLines > 0 ? (
            <p className="text-xs text-amber-700">
              Há mais de 3 linhas. Remova o excedente antes de incluir.
            </p>
          ) : null}
          <button
            type="button"
            onClick={addToDraft}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            <Plus className="size-4" /> Incluir no pedido
          </button>
        </div>
      </Panel>

      <Panel className="flex h-fit flex-col p-4 lg:sticky lg:top-0">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Lista do pedido ({draft.length})
        </h2>
        {adapters.persistHint ? (
          <p className="mt-1 text-xs leading-snug text-slate-500">{adapters.persistHint}</p>
        ) : null}
        {draft.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Nenhuma credencial incluída.</p>
        ) : (
          <ul className="mt-3 flex max-h-[min(55vh,32rem)] flex-col gap-2 overflow-y-auto overscroll-contain">
            {draft.map((d) => (
              <li
                key={d.key}
                className="rounded-md border border-slate-200 bg-slate-50 p-2"
              >
                <div className="flex items-start gap-3">
                  <img
                    src={adapters.thumbUrl(d.modelo_arquivo)}
                    alt=""
                    className="h-16 w-12 shrink-0 rounded object-cover bg-slate-200"
                  />
                  <div className="min-w-0 flex-1 text-sm leading-snug text-slate-800">
                    <p className="truncate">{d.linha1}</p>
                    {d.linha2 ? <p className="truncate">{d.linha2}</p> : null}
                    {d.linha3 ? <p className="truncate">{d.linha3}</p> : null}
                  </div>
                  <button
                    type="button"
                    aria-label="Remover"
                    onClick={() => {
                      dirtyRef.current = true;
                      setDraft((prev) => prev.filter((x) => x.key !== d.key));
                    }}
                    className="shrink-0 rounded p-1 text-slate-500 hover:bg-white hover:text-red-600"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          disabled={createMut.isPending || draft.length === 0}
          onClick={submitPedido}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
        >
          {createMut.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Check className="size-4" />
          )}
          Enviar pedido
        </button>
        {error ? (
          <p className="mt-2 text-sm text-red-600">{error}</p>
        ) : null}
        {okMsg ? (
          <p className="mt-2 text-sm text-emerald-700">{okMsg}</p>
        ) : null}
      </Panel>
    </div>
  );
}
