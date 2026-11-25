import { Eye, EyeOff, Globe, Smartphone } from "lucide-react";
import { useEffect, useRef } from "react";

import {
  registrarManutencaoVisualizacoes,
  type ManutencaoVisualizacao,
} from "@/api/manutencao";
import { isSagraManutencaoApp } from "@/lib/sagraNativeApp";

import { formatDataHora, pessoa, tempoRelativo } from "../manutencaoUi";
import { Badge } from "./ManutencaoShared";

/** Não reenviar o mesmo pedido antes disso (o servidor guarda a 1ª e a última vez). */
const REENVIO_MS = 5 * 60_000;

export function resumoVistoPor(lista: readonly ManutencaoVisualizacao[]): string {
  if (lista.length === 0) return "Ninguém visualizou ainda";
  return lista
    .map((v) => `${pessoa(v.nome, v.ponto)} — ${formatDataHora(v.primeira_em)}${v.origem === "app" ? " (app)" : ""}`)
    .join("\n");
}

/** Selo "visto por N" com a lista de quem viu no tooltip. */
export function VistoPorBadge({
  visualizacoes,
  destacarNinguem = false,
}: {
  visualizacoes?: readonly ManutencaoVisualizacao[];
  destacarNinguem?: boolean;
}) {
  const lista = visualizacoes ?? [];
  if (lista.length === 0) {
    if (!destacarNinguem) return null;
    return (
      <Badge className="bg-amber-50 text-amber-800 ring-amber-200">
        <span title="Nenhum operador visualizou este pedido ainda" className="inline-flex items-center gap-1">
          <EyeOff className="h-3 w-3" aria-hidden />
          Não visto
        </span>
      </Badge>
    );
  }
  return (
    <Badge className="bg-sky-50 text-sky-800 ring-sky-200">
      <span title={resumoVistoPor(lista)} className="inline-flex items-center gap-1">
        <Eye className="h-3 w-3" aria-hidden />
        Visto por {lista.length}
      </span>
    </Badge>
  );
}

/** Lista completa (modal de detalhes): quem viu, primeira e última vez, app/web. */
export function VisualizacoesLista({
  visualizacoes,
}: {
  visualizacoes?: readonly ManutencaoVisualizacao[];
}) {
  const lista = visualizacoes ?? [];
  if (lista.length === 0) {
    return (
      <p className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200">
        <EyeOff className="h-4 w-4 shrink-0" aria-hidden />
        Nenhum operador visualizou este pedido ainda.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
      {lista.map((v) => {
        const Icone = v.origem === "app" ? Smartphone : Globe;
        return (
          <li key={v.ponto} className="flex items-start gap-3 px-3 py-2 text-sm">
            <Icone
              className="mt-0.5 h-4 w-4 shrink-0 text-slate-400"
              aria-label={v.origem === "app" ? "Visto no app" : "Visto no navegador"}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-slate-800">{pessoa(v.nome, v.ponto)}</p>
              <p className="text-xs text-slate-500">
                Viu em {formatDataHora(v.primeira_em)}
                {v.vezes > 1 ? ` · última vez ${tempoRelativo(v.ultima_em)}` : ""}
                {v.origem === "app" ? " · pelo app" : ""}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Registra que o usuário viu os pedidos exibidos na tela, só com a página
 * visível (app em primeiro plano / aba ativa).
 */
export function useRegistrarVisualizacoes(ids: readonly number[], enabled = true) {
  const enviados = useRef(new Map<number, number>());
  const chave = [...ids].sort((a, b) => a - b).join(",");

  useEffect(() => {
    if (!enabled || !chave) return;
    const origem = isSagraManutencaoApp() ? "app" : "web";
    let timer: ReturnType<typeof setTimeout> | null = null;

    const enviar = () => {
      if (document.visibilityState !== "visible") return;
      const agora = Date.now();
      const pendentes = chave
        .split(",")
        .map(Number)
        .filter((id) => id > 0 && agora - (enviados.current.get(id) ?? 0) > REENVIO_MS);
      if (pendentes.length === 0) return;
      for (const id of pendentes) enviados.current.set(id, agora);
      registrarManutencaoVisualizacoes(pendentes, origem).catch(() => {
        for (const id of pendentes) enviados.current.delete(id);
      });
    };

    // Pequeno atraso: conta como visto quem ficou na tela, não quem passou rápido.
    timer = setTimeout(enviar, 1500);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        if (timer) clearTimeout(timer);
        timer = setTimeout(enviar, 1500);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [chave, enabled]);
}
