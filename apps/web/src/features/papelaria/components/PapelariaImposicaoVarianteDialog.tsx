import { cn } from "@sagra/ui";
import { ArrowLeft, Loader2, Printer, Settings2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { fetchPreviaJuntada } from "@/api/imposicaoPerfil";
import type {
  ImposicaoVariante,
  ImposicaoVariantesResponse,
  JuntadaCandidata,
  PreviaJuntada,
} from "@/features/papelaria/imposicao/perfil/types";

const VARIANTES: Array<{ id: ImposicaoVariante; label: string; descricao: string }> = [
  { id: "offset", label: "Offset", descricao: "Folha para impressão offset" },
  { id: "digital", label: "Digital", descricao: "Folha para impressão digital" },
];

type Props = {
  open: boolean;
  ano: number;
  nro: number;
  modeloId: number | null;
  opcoes: ImposicaoVariantesResponse | null;
  loading?: boolean;
  submitting?: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: (payload: {
    variante: ImposicaoVariante;
    juntada_os: Array<{ ano: number; nro: number }>;
  }) => void;
};

/**
 * Pergunta só se a imposição é Offset ou Digital e gera com a configuração
 * salva em Configurações. Se o perfil permite juntada e há OSs compatíveis,
 * mostra um segundo passo para escolher quais entram na mesma folha.
 */
export function PapelariaImposicaoVarianteDialog({
  open,
  ano,
  nro,
  modeloId,
  opcoes,
  loading,
  submitting,
  error,
  onClose,
  onConfirm,
}: Props) {
  const [escolhida, setEscolhida] = useState<ImposicaoVariante | null>(null);
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [previa, setPrevia] = useState<PreviaJuntada | null>(null);
  const [previaLoading, setPreviaLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEscolhida(null);
    setSelecionadas(new Set());
    setPrevia(null);
  }, [open, opcoes]);

  const juntada = escolhida ? opcoes?.juntada?.[escolhida] : undefined;
  const candidatas: JuntadaCandidata[] = juntada?.candidatas ?? [];
  const passoJuntada = Boolean(escolhida && candidatas.length > 0);
  const membros = useMemo(
    () => candidatas.filter((c) => selecionadas.has(`${c.ano}-${c.nro}`)).map((c) => ({ ano: c.ano, nro: c.nro })),
    [candidatas, selecionadas],
  );

  useEffect(() => {
    if (!open || !escolhida || !passoJuntada || modeloId == null) return;
    let cancel = false;
    setPreviaLoading(true);
    fetchPreviaJuntada(ano, nro, { modelo_id: modeloId, variante: escolhida, juntada_os: membros })
      .then((res) => {
        if (!cancel) setPrevia(res);
      })
      .catch((e: unknown) => {
        if (!cancel) setPrevia({ ok: false, mensagem: e instanceof Error ? e.message : "Falha ao calcular." });
      })
      .finally(() => {
        if (!cancel) setPreviaLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [open, escolhida, passoJuntada, membros, ano, nro, modeloId]);

  if (!open) return null;

  const escolher = (v: ImposicaoVariante) => {
    const temCandidatas = (opcoes?.juntada?.[v]?.candidatas?.length ?? 0) > 0;
    if (temCandidatas) {
      setEscolhida(v);
      return;
    }
    setEscolhida(v);
    onConfirm({ variante: v, juntada_os: [] });
  };

  const maxOs = juntada?.max_os ?? juntada?.max_slots ?? 1;
  const limiteAtingido = membros.length + 1 >= maxOs;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="imposicao-dialog-title"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !submitting) onClose();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div className="flex items-center gap-2">
            {passoJuntada ? (
              <button
                type="button"
                className="rounded p-1 text-slate-500 hover:bg-slate-100"
                onClick={() => {
                  setEscolhida(null);
                  setSelecionadas(new Set());
                }}
                disabled={submitting}
                aria-label="Voltar"
              >
                <ArrowLeft className="size-4" />
              </button>
            ) : null}
            <div>
              <h2 id="imposicao-dialog-title" className="text-sm font-bold text-slate-900">
                {passoJuntada ? `Imposição ${escolhida === "offset" ? "Offset" : "Digital"} — juntar OSs?` : "Imposição Offset ou Digital?"}
              </h2>
              <p className="text-[11px] text-slate-500">
                {passoJuntada
                  ? "Escolha as OSs que entram na mesma folha, ou gere só esta."
                  : "A folha, as posições e as marcas vêm de Configurações → Papelaria → Imposição."}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="rounded p-1 text-slate-500 hover:bg-slate-100"
            onClick={onClose}
            disabled={submitting}
            aria-label="Fechar"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-slate-600">
              <Loader2 className="size-4 animate-spin" /> Carregando configurações…
            </div>
          ) : !opcoes ? null : !passoJuntada ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {VARIANTES.map((v) => {
                const info = opcoes.variantes[v.id];
                const disabled = !info?.disponivel || Boolean(submitting);
                const gerando = submitting && escolhida === v.id;
                return (
                  <button
                    key={v.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => escolher(v.id)}
                    className={cn(
                      "flex flex-col items-start gap-1.5 rounded-xl border-2 p-4 text-left transition",
                      info?.disponivel
                        ? "border-slate-200 hover:border-secondary-blue hover:bg-secondary-blue/5"
                        : "cursor-not-allowed border-dashed border-slate-200 bg-slate-50 opacity-70",
                      gerando && "border-secondary-blue bg-secondary-blue/5",
                    )}
                    data-testid={`imposicao-variante-${v.id}`}
                  >
                    <span className="flex items-center gap-2 text-base font-bold text-slate-900">
                      {gerando ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4 text-secondary-blue" />}
                      {v.label}
                    </span>
                    <span className="text-[11px] text-slate-500">{v.descricao}</span>
                    {info?.disponivel ? (
                      <>
                        {info.resumo ? <span className="text-[11px] font-medium text-slate-700">{info.resumo}</span> : null}
                        <span className="text-[10px] text-slate-400">
                          PDF em {info.destino_pdf === "offset" ? "Offset" : "Digital"}
                          {info.fonte === "configuracao_antiga" ? " · configuração antiga" : ""}
                        </span>
                        {info.pasta_pdf ? (
                          <span className="break-all text-[10px] text-slate-500">
                            Mover para {info.pasta_pdf}
                          </span>
                        ) : null}
                        {info.aviso ? (
                          <span
                            className="text-[11px] font-medium text-amber-700"
                            data-testid={`imposicao-variante-${v.id}-aviso`}
                          >
                            {info.aviso}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <span className="flex items-center gap-1 text-[11px] text-amber-700">
                        <Settings2 className="size-3" />
                        {info?.erros?.[0] ?? "Não configurado."}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-[11px] text-slate-500">
                Andamento: {juntada?.situacao || "—"} · até {maxOs} OS{maxOs === 1 ? "" : "s"} por folha.
              </p>
              <ul className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-1">
                {candidatas.map((c) => {
                  const key = `${c.ano}-${c.nro}`;
                  const checked = selecionadas.has(key);
                  const bloqueado = !checked && limiteAtingido;
                  return (
                    <li key={key}>
                      <label
                        className={cn(
                          "flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-50",
                          bloqueado && "cursor-not-allowed opacity-50",
                        )}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5 size-3.5 rounded border-slate-300"
                          checked={checked}
                          disabled={bloqueado || submitting}
                          onChange={() =>
                            setSelecionadas((prev) => {
                              const next = new Set(prev);
                              if (next.has(key)) next.delete(key);
                              else next.add(key);
                              return next;
                            })
                          }
                        />
                        <span>
                          <span className="font-semibold">{String(c.nro).padStart(5, "0")}</span>
                          {" — "}
                          {c.label || c.produto}
                          <span className="text-slate-400"> · tiragem {c.tiragem}</span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              <p
                className={cn(
                  "min-h-4 text-[11px]",
                  previa && !previa.ok ? "text-amber-700" : "text-slate-600",
                )}
                aria-live="polite"
              >
                {previaLoading
                  ? "Calculando slots…"
                  : previa
                    ? previa.ok
                      ? `Slots: ${previa.slots.join(" + ")} = ${previa.total_slots} de ${previa.max_slots} · ${previa.folhas} folhas`
                      : previa.mensagem
                    : null}
              </p>
            </div>
          )}
        </div>

        {error ? <p className="px-4 pb-2 text-xs text-red-600">{error}</p> : null}

        <footer className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3">
          <button
            type="button"
            className="sagra-btn sagra-btn--outline sagra-btn--sm"
            onClick={onClose}
            disabled={submitting}
          >
            Cancelar
          </button>
          {passoJuntada && escolhida ? (
            <button
              type="button"
              className="sagra-btn sagra-btn--primary sagra-btn--sm"
              disabled={submitting || previaLoading || (previa !== null && !previa.ok)}
              onClick={() => onConfirm({ variante: escolhida, juntada_os: membros })}
            >
              {submitting ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {membros.length ? `Gerar JDF com ${membros.length + 1} OSs` : "Gerar JDF só desta OS"}
            </button>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
