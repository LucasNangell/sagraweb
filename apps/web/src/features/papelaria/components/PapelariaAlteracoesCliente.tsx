import { cn } from "@sagra/ui";
import { ChevronDown, MessageSquareWarning } from "lucide-react";
import { useState } from "react";

import type { PapelariaClienteAlteracao } from "../types";

/** Texto com `**negrito**` (marcação do PDF) mostrado como negrito de verdade. */
function Valor({ texto, vazio }: { texto: string; vazio: string }) {
  if (!texto) return <em className="text-amber-700/70">{vazio}</em>;
  const partes = texto.split("**");
  return (
    <span className="whitespace-pre-wrap break-words">
      {partes.map((parte, i) =>
        i % 2 === 1 && i < partes.length - 1 ? (
          <b key={i} className="font-extrabold">
            {parte}
          </b>
        ) : (
          <span key={i}>{i % 2 === 1 ? `**${parte}` : parte}</span>
        ),
      )}
    </span>
  );
}

/**
 * Resumo do pedido de alteração do cliente, no topo da prévia: campos do
 * formulário, textos editados no PDF, redes sociais e a observação. A prévia
 * abaixo já mostra a prova com tudo isso aplicado.
 */
export function PapelariaAlteracoesCliente({
  alteracao,
  rotulos = {},
  className,
}: {
  alteracao: PapelariaClienteAlteracao;
  /** Rótulo de cada campo do formulário (chave → rótulo). */
  rotulos?: Record<string, string>;
  className?: string;
}) {
  const [aberto, setAberto] = useState(true);
  const campos = alteracao.campos_alterados ?? [];
  const textos = alteracao.textos_alterados ?? [];
  const redes = alteracao.redes_alteradas ?? [];
  const total = campos.length + textos.length + redes.length;
  const observacao = alteracao.observacao?.trim() ?? "";

  return (
    <section
      className={cn("shrink-0 border-b border-amber-200 bg-amber-50 text-xs text-amber-950", className)}
      data-testid="papelaria-alteracoes-cliente"
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
      >
        <MessageSquareWarning className="size-3.5 shrink-0 text-amber-700" aria-hidden />
        <span className="min-w-0 flex-1 font-semibold">
          Alterações solicitadas pelo cliente{alteracao.versao ? ` — prova v${alteracao.versao}` : ""}
          <span className="ml-1 font-normal text-amber-800">
            {total ? `· ${total} ${total === 1 ? "alteração aplicada" : "alterações aplicadas"} na prévia` : ""}
          </span>
        </span>
        <ChevronDown className={cn("size-3.5 shrink-0 transition-transform", aberto && "rotate-180")} aria-hidden />
      </button>
      {aberto ? (
        <div className="max-h-48 space-y-2 overflow-y-auto px-3 pb-2.5">
          {campos.length || textos.length || redes.length ? (
            <ul className="space-y-1">
              {campos.map((c) => (
                <li key={`c-${c.key}`} data-testid="papelaria-alteracao-campo">
                  <span className="font-semibold">{rotulos[c.key] ?? c.key}:</span>{" "}
                  <Valor texto={c.antes} vazio="vazio" /> <span aria-hidden>→</span>{" "}
                  <strong>
                    <Valor texto={c.depois} vazio="vazio" />
                  </strong>
                </li>
              ))}
              {textos.map((t) => (
                <li key={`t-${t.chave}`} data-testid="papelaria-alteracao-texto">
                  <span className="font-semibold">Texto do PDF:</span>{" "}
                  <Valor texto={t.antes} vazio={t.marcador} /> <span aria-hidden>→</span>{" "}
                  <strong>
                    <Valor texto={t.depois} vazio="removido" />
                  </strong>
                </li>
              ))}
              {redes.map((r) => (
                <li key={`r-${r.chave}`} data-testid="papelaria-alteracao-rede">
                  <span className="font-semibold">{r.rede}:</span>{" "}
                  {!r.antes ? (
                    <>
                      incluída <strong>{r.depois}</strong>
                    </>
                  ) : !r.depois ? (
                    <>
                      retirada (<span className="line-through">{r.antes}</span>)
                    </>
                  ) : (
                    <>
                      {r.antes} <span aria-hidden>→</span> <strong>{r.depois}</strong>
                    </>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
          {observacao ? (
            <p className="rounded border border-amber-200 bg-white/70 px-2 py-1.5 whitespace-pre-wrap">
              <span className="font-semibold">Observação do cliente: </span>
              {observacao}
            </p>
          ) : null}
          {!total && !observacao ? <p>O cliente pediu alteração sem detalhar campos.</p> : null}
        </div>
      ) : null}
    </section>
  );
}
