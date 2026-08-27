import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Loader2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
  aprovarProvaCredenciaisDepol,
  cancelarCredenciaisDepolPedido,
  createCredenciaisDepolPedido,
  descartarProvaCredenciaisDepol,
  desvincularCredenciaisDepolPedido,
  executarCredenciaisDepolOs,
  executarCredenciaisDepolPedido,
  fetchCredenciaisDepolModelos,
  fetchCredenciaisDepolPedidoJob,
  fetchCredenciaisDepolPedidos,
  modeloThumbUrl,
  vincularCredenciaisDepolPedido,
  type CredenciaisDepolItem,
  type CredenciaisDepolPedido,
} from "@/api/credenciais-depol";
import { queryKeys } from "@/api/query-keys";
import { CredenciaisDepolPedidoPanel } from "@/features/credenciais-depol/components/CredenciaisDepolPedidoPanel";
import { DEPOL_DRAFT_STORAGE_STAFF } from "@/features/credenciais-depol/depolPedidoDraftStorage";
import { useOsSelectionStore } from "@/features/os/osSelectionStore";
import {
  readPapelariaSession,
  setPapelariaNavigationContext,
} from "@/features/papelaria/papelariaSession";

type TabId = "pedido" | "execucao";

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

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    aberto: "Aberto",
    vinculado: "Vinculado",
    em_execucao: "Em execução",
    concluido: "Concluído",
    cancelado: "Cancelado",
    falha: "Falha",
  };
  return map[status] ?? status;
}

const STAFF_PEDIDO_ADAPTERS = {
  queryKey: queryKeys.credenciaisDepol.modelos,
  fetchModelos: fetchCredenciaisDepolModelos,
  createPedido: createCredenciaisDepolPedido,
  thumbUrl: modeloThumbUrl,
  draftStorageKey: DEPOL_DRAFT_STORAGE_STAFF,
  invalidateKeys: [["credenciais-depol", "pedidos"]] as const,
};

export function CredenciaisDepolPage() {
  const [tab, setTab] = useState<TabId>("pedido");
  const selectedOs = useOsSelectionStore((s) => s.selected);
  const session = readPapelariaSession();

  // Preferência: OS da home (Zustand). Fallback: sessionStorage (navegação Papelaria).
  const osId = selectedOs?.nr_os
    ? selectedOs.nr_os
    : session.osId
      ? parseInt(session.osId, 10)
      : NaN;
  const osAno = selectedOs?.ano
    ? selectedOs.ano
    : session.osAno
      ? parseInt(session.osAno, 10)
      : NaN;
  const hasOs = Number.isFinite(osId) && Number.isFinite(osAno) && osId > 0;

  // Mantém sessionStorage alinhado para abas/execução e refresh parcial.
  useEffect(() => {
    if (selectedOs?.nr_os && selectedOs?.ano) {
      setPapelariaNavigationContext({
        nr_os: selectedOs.nr_os,
        ano: selectedOs.ano,
        produto: selectedOs.produto,
      });
    }
  }, [selectedOs?.nr_os, selectedOs?.ano, selectedOs?.produto]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto md:h-full md:overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-end justify-between gap-3 px-1">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Credenciais DEPOL
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Pedido sem OS; execução após vincular à OS selecionada.
          </p>
        </div>
        {hasOs ? (
          <p className="rounded-md bg-slate-100 px-3 py-1.5 text-sm text-slate-700">
            OS atual: <strong>{osId}</strong> / {osAno}
          </p>
        ) : (
          <p className="rounded-md bg-amber-50 px-3 py-1.5 text-sm text-amber-800">
            Nenhuma OS selecionada (necessária só na aba Execução)
          </p>
        )}
      </header>

      <div className="flex shrink-0 gap-2 border-b border-slate-200">
        {(
          [
            ["pedido", "Pedido"],
            ["execucao", "Execução"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === id
                ? "border-slate-900 text-slate-900"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch]">
        {tab === "pedido" ? (
          <CredenciaisDepolPedidoPanel
            adapters={STAFF_PEDIDO_ADAPTERS}
            onSubmitted={() => setTab("execucao")}
          />
        ) : (
          <ExecucaoTab hasOs={hasOs} osAno={osAno} osId={osId} />
        )}
      </div>
    </div>
  );
}

function ExecucaoTab({
  hasOs,
  osAno,
  osId,
}: {
  hasOs: boolean;
  osAno: number;
  osId: number;
}) {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const abertosQ = useQuery({
    queryKey: queryKeys.credenciaisDepol.pedidos("abertos"),
    queryFn: () => fetchCredenciaisDepolPedidos({ abertos: true }),
  });

  const vinculadosQ = useQuery({
    queryKey: queryKeys.credenciaisDepol.pedidos(
      hasOs ? `os-${osAno}-${osId}` : "os-none",
    ),
    queryFn: () => fetchCredenciaisDepolPedidos({ ano: osAno, nro: osId }),
    enabled: hasOs,
  });

  const jobQ = useQuery({
    queryKey: queryKeys.credenciaisDepol.pedidoJob(selectedId ?? 0),
    queryFn: () => fetchCredenciaisDepolPedidoJob(selectedId!),
    enabled: selectedId != null,
    refetchInterval: (q) => {
      const st = q.state.data?.job?.status;
      if (st === "pending" || st === "processing") return 3000;
      return false;
    },
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["credenciais-depol"] });
  };

  const vincularMut = useMutation({
    mutationFn: (id: number) => vincularCredenciaisDepolPedido(id, osAno, osId),
    onSuccess: (p) => {
      setMsg(`Pedido #${p.id} vinculado à OS ${osId}/${osAno}.`);
      setErr(null);
      setSelectedId(p.id);
      invalidate();
    },
    onError: (e: Error) => setErr(e.message),
  });

  const desvincularMut = useMutation({
    mutationFn: desvincularCredenciaisDepolPedido,
    onSuccess: () => {
      setMsg("Pedido desvinculado.");
      setErr(null);
      invalidate();
    },
    onError: (e: Error) => setErr(e.message),
  });

  const executarMut = useMutation({
    mutationFn: (payload: { mode: "pedido"; id: number } | { mode: "os" }) =>
      payload.mode === "os"
        ? executarCredenciaisDepolOs(osAno, osId)
        : executarCredenciaisDepolPedido(payload.id),
    onSuccess: (res) => {
      const nPed = res.num_pedidos ?? res.pedidos?.length ?? 1;
      const nItens = res.num_itens;
      setMsg(
        nItens != null
          ? `Execução enfileirada: ${nPed} pedido(s), ${nItens} credencial(is) → job #${res.job.id} (uma prova).`
          : `Execução enfileirada: ${nPed} pedido(s) → job #${res.job.id} (uma prova).`,
      );
      setErr(null);
      if (res.pedido?.id) setSelectedId(res.pedido.id);
      invalidate();
    },
    onError: (e: Error) => setErr(e.message),
  });

  const cancelarMut = useMutation({
    mutationFn: cancelarCredenciaisDepolPedido,
    onSuccess: () => {
      setMsg("Pedido cancelado.");
      invalidate();
    },
    onError: (e: Error) => setErr(e.message),
  });

  const aprovarMut = useMutation({
    mutationFn: aprovarProvaCredenciaisDepol,
    onSuccess: (res) => {
      const token = res.proof_token;
      setMsg(
        token
          ? `Prova aprovada. Token: ${token}`
          : "Prova aprovada.",
      );
      setErr(null);
      invalidate();
    },
    onError: (e: Error) => setErr(e.message),
  });

  const descartarMut = useMutation({
    mutationFn: descartarProvaCredenciaisDepol,
    onSuccess: () => {
      setMsg("Prova descartada — pedidos do job voltaram a vinculado.");
      invalidate();
    },
    onError: (e: Error) => setErr(e.message),
  });

  const vinculados = vinculadosQ.data?.pedidos ?? [];
  const abertos = abertosQ.data?.pedidos ?? [];
  const elegiveisExecucao = useMemo(
    () =>
      vinculados.filter(
        (p) => p.status === "vinculado" || p.status === "falha",
      ),
    [vinculados],
  );
  const emExecucao = vinculados.some((p) => p.status === "em_execucao");

  const selectedPedido: CredenciaisDepolPedido | null = useMemo(() => {
    if (!selectedId) return null;
    return (
      vinculados.find((p) => p.id === selectedId) ||
      abertos.find((p) => p.id === selectedId) ||
      jobQ.data?.pedido ||
      null
    );
  }, [selectedId, vinculados, abertos, jobQ.data?.pedido]);

  if (!hasOs) {
    return (
      <div className="mx-auto w-full max-w-6xl p-1 pb-6">
      <Panel className="p-6">
        <p className="text-slate-700">
          Selecione uma OS no{" "}
          <Link to="/" className="font-medium text-slate-900 underline">
            Início
          </Link>{" "}
          para vincular pedidos e executar a geração Corel.
        </p>
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-slate-500">
            Pedidos abertos (sem OS)
          </h3>
          <PedidoList
            pedidos={abertos}
            selectedId={selectedId}
            onSelect={setSelectedId}
            empty="Nenhum pedido aberto."
          />
        </div>
      </Panel>
      </div>
    );
  }

  const job = jobQ.data?.job;
  const busy =
    vincularMut.isPending ||
    executarMut.isPending ||
    aprovarMut.isPending ||
    descartarMut.isPending;

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-4 p-1 pb-6 lg:grid-cols-2">
      <div className="flex flex-col gap-4">
        <Panel className="p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Pedidos abertos — vincular à OS {osId}/{osAno}
          </h2>
          <PedidoList
            pedidos={abertos}
            selectedId={selectedId}
            onSelect={setSelectedId}
            empty="Nenhum pedido aberto."
            action={(p) => (
              <button
                type="button"
                disabled={busy}
                onClick={() => vincularMut.mutate(p.id)}
                className="rounded bg-slate-900 px-2 py-1 text-xs text-white hover:bg-slate-800 disabled:opacity-50"
              >
                Vincular
              </button>
            )}
          />
        </Panel>

        <Panel className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Pedidos desta OS
            </h2>
            {elegiveisExecucao.length > 0 ? (
              <button
                type="button"
                disabled={busy || emExecucao}
                onClick={() => executarMut.mutate({ mode: "os" })}
                className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
              >
                Executar OS ({elegiveisExecucao.length} pedido
                {elegiveisExecucao.length === 1 ? "" : "s"} → 1 prova)
              </button>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Todos os pedidos vinculados entram no mesmo CDR e em uma única
            prova.
          </p>
          <PedidoList
            pedidos={vinculados}
            selectedId={selectedId}
            onSelect={setSelectedId}
            empty="Nenhum pedido vinculado a esta OS."
          />
        </Panel>
      </div>

      <Panel className="p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Detalhe / execução
        </h2>
        {!selectedPedido ? (
          <p className="mt-3 text-sm text-slate-500">
            Selecione um pedido na lista.
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-3 text-sm">
            <p>
              <strong>#{selectedPedido.id}</strong> ·{" "}
              {statusLabel(selectedPedido.status)}
              {selectedPedido.titulo ? ` · ${selectedPedido.titulo}` : ""}
            </p>
            <ul className="max-h-48 overflow-auto rounded border border-slate-200 bg-slate-50 p-2">
              {selectedPedido.itens.map((it: CredenciaisDepolItem, i) => (
                <li key={it.id ?? i} className="border-b border-slate-200 py-1 last:border-0">
                  <span className="font-medium">{it.modelo_arquivo}</span>
                  <span className="text-slate-500">
                    {" "}
                    — {it.linha1}
                    {it.linha2 ? ` / ${it.linha2}` : ""}
                    {it.linha3 ? ` / ${it.linha3}` : ""}
                  </span>
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap gap-2">
              {selectedPedido.status === "vinculado" ||
              selectedPedido.status === "falha" ? (
                <>
                  <button
                    type="button"
                    disabled={busy || emExecucao}
                    onClick={() =>
                      executarMut.mutate({
                        mode: "pedido",
                        id: selectedPedido.id,
                      })
                    }
                    className="rounded-md bg-emerald-700 px-3 py-2 text-white hover:bg-emerald-600 disabled:opacity-50"
                  >
                    Executar OS (
                    {
                      elegiveisExecucao.length || 1
                    }{" "}
                    pedido
                    {(elegiveisExecucao.length || 1) === 1 ? "" : "s"} → 1
                    prova)
                  </button>
                  {selectedPedido.status === "vinculado" ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => desvincularMut.mutate(selectedPedido.id)}
                      className="rounded-md border border-slate-300 px-3 py-2 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Desvincular
                    </button>
                  ) : null}
                </>
              ) : null}
              {selectedPedido.status === "aberto" ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => cancelarMut.mutate(selectedPedido.id)}
                  className="inline-flex items-center gap-1 rounded-md border border-red-200 px-3 py-2 text-red-700 hover:bg-red-50"
                >
                  <X className="size-4" /> Cancelar
                </button>
              ) : null}
              {job?.status === "completed" &&
              (job.prova_revisao === "pending" || !job.prova_revisao) ? (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => aprovarMut.mutate(selectedPedido.id)}
                    className="rounded-md bg-slate-900 px-3 py-2 text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    Aprovar prova
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => descartarMut.mutate(selectedPedido.id)}
                    className="rounded-md border border-slate-300 px-3 py-2 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Descartar prova
                  </button>
                </>
              ) : null}
            </div>

            {job ? (
              <div className="rounded-md border border-slate-200 bg-white p-3">
                <p>
                  Job #{job.id}: <strong>{job.status}</strong>
                  {job.prova_revisao ? ` · prova: ${job.prova_revisao}` : ""}
                </p>
                {job.arquivo_pdf ? (
                  <p className="text-slate-600">PDF: {job.arquivo_pdf}</p>
                ) : null}
                {job.arquivo_cdr ? (
                  <p className="text-slate-600">CDR: {job.arquivo_cdr}</p>
                ) : null}
                {job.erro ? (
                  <p className="mt-1 text-red-600">{job.erro}</p>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
        {err ? <p className="mt-3 text-sm text-red-600">{err}</p> : null}
        {msg ? <p className="mt-3 text-sm text-emerald-700">{msg}</p> : null}
      </Panel>
    </div>
  );
}

function PedidoList({
  pedidos,
  selectedId,
  onSelect,
  empty,
  action,
}: {
  pedidos: CredenciaisDepolPedido[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  empty: string;
  action?: (p: CredenciaisDepolPedido) => ReactNode;
}) {
  if (!pedidos.length) {
    return <p className="mt-3 text-sm text-slate-500">{empty}</p>;
  }
  return (
    <ul className="mt-3 flex flex-col gap-2">
      {pedidos.map((p) => {
        const active = selectedId === p.id;
        return (
          <li key={p.id}>
            <div
              className={`flex items-center gap-2 rounded-md border px-3 py-2 ${
                active
                  ? "border-slate-900 bg-slate-50"
                  : "border-slate-200 hover:border-slate-400"
              }`}
            >
              <button
                type="button"
                className="min-w-0 flex-1 text-left text-sm"
                onClick={() => onSelect(p.id)}
              >
                <span className="font-medium">#{p.id}</span>{" "}
                <span className="text-slate-500">
                  {statusLabel(p.status)} · {p.itens?.length ?? 0} item(ns)
                </span>
                {p.titulo ? (
                  <span className="block truncate text-slate-700">{p.titulo}</span>
                ) : null}
              </button>
              {action?.(p)}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
