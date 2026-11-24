import { Copy, Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";

import type { PapelariaRepeticao } from "../types";

/**
 * Repetição de SP (abaixo das Observações): «Replicar SP 1234/25» monta a
 * base da nova prova a partir da última prova da OS repetida. Sem número na
 * observação, o usuário informa a OS.
 */
export function PapelariaReplicarSp({
  repeticao,
  pending,
  erro,
  onReplicar,
}: {
  repeticao: PapelariaRepeticao;
  pending: boolean;
  erro?: string | null;
  onReplicar: (origem: { ano: number; nro: number } | null) => void;
}) {
  const [nro, setNro] = useState("");
  const [ano, setAno] = useState(String(new Date().getFullYear() % 100));
  const temOrigem = Boolean(repeticao.origem_nro && repeticao.origem_ano);
  const base = repeticao.base;
  const rotulo =
    repeticao.rotulo ??
    (base?.origem ? `${String(base.origem.nro).padStart(4, "0")}/${String(base.origem.ano % 100).padStart(2, "0")}` : "");

  const replicar = () => {
    if (temOrigem) {
      onReplicar(null);
      return;
    }
    const n = parseInt(nro, 10);
    let a = parseInt(ano, 10);
    if (!Number.isFinite(n) || !Number.isFinite(a)) return;
    if (a < 100) a += 2000;
    onReplicar({ ano: a, nro: n });
  };

  return (
    <div className="mt-2 space-y-1.5" data-testid="papelaria-repeticao">
      {!temOrigem ? (
        <div className="flex items-center gap-1 text-[11px] text-neutral-600">
          <span>Repetição da OS</span>
          <input
            aria-label="Número da OS repetida"
            className="w-16 rounded border border-sagra-border px-1.5 py-0.5 text-xs"
            inputMode="numeric"
            value={nro}
            onChange={(e) => setNro(e.target.value.replace(/\D/g, ""))}
          />
          <span>/</span>
          <input
            aria-label="Ano da OS repetida"
            className="w-10 rounded border border-sagra-border px-1.5 py-0.5 text-xs"
            inputMode="numeric"
            value={ano}
            onChange={(e) => setAno(e.target.value.replace(/\D/g, ""))}
          />
        </div>
      ) : null}
      <button
        type="button"
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-secondary-blue bg-secondary-blue px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:bg-secondary-blue/90 disabled:opacity-55"
        onClick={replicar}
        disabled={pending || (!temOrigem && !nro)}
        title="Monta a base da nova prova a partir da última prova da OS repetida (Frente/Verso das molduras)"
        data-testid="papelaria-replicar-sp"
      >
        {pending ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
        ) : base ? (
          <RefreshCw className="size-3.5" aria-hidden />
        ) : (
          <Copy className="size-3.5" aria-hidden />
        )}
        {base ? "Replicar de novo" : `Replicar SP${temOrigem ? ` ${rotulo}` : ""}`}
      </button>
      {base ? (
        <p className="text-[10px] leading-snug text-neutral-500" data-testid="papelaria-repeticao-base">
          Base montada de <span className="font-medium">{base.arquivo_origem ?? `SP ${rotulo}`}</span>
          {base.faces?.length ? ` (${base.faces.map((f) => f.face).join(" e ")})` : ""}. Edite os textos
          direto na prévia.
        </p>
      ) : null}
      {(base?.avisos ?? []).map((a) => (
        <p key={a} className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] text-amber-900">
          {a}
        </p>
      ))}
      {erro ? <p className="text-[11px] text-sagra-danger">{erro}</p> : null}
    </div>
  );
}
