import { useQuery } from "@tanstack/react-query";
import { Download, History, Smartphone, Unplug } from "lucide-react";

import {
  fetchManutencaoAparelhos,
  manutencaoKeys,
  revogarManutencaoAparelho,
  type ManutencaoAparelho,
} from "@/api/manutencao";
import { sagraBtn } from "@/components/ui/sagraBtn";
import { manutencaoApkUrl } from "@/lib/sagraNativeApp";

import { formatDataHora, pessoa, tempoRelativo } from "../manutencaoUi";
import { useManutencaoMutation } from "../useManutencaoData";
import { Badge, EmptyState, LoadingBlock, Panel, SectionTitle } from "./ManutencaoShared";

/** Gerência → App: aparelhos conectados, aberturas do app e versão publicada. */
export function AparelhosPanel() {
  const q = useQuery({
    queryKey: manutencaoKeys.aparelhos,
    queryFn: fetchManutencaoAparelhos,
    refetchInterval: 60_000,
  });
  const revogar = useManutencaoMutation(revogarManutencaoAparelho, {
    success: "Aparelho desconectado",
  });

  if (q.isLoading) return <LoadingBlock label="Carregando aparelhos…" />;
  const aparelhos = q.data?.items ?? [];
  const aberturas = q.data?.aberturas ?? [];
  const versao = q.data?.versao ?? null;

  const desconectar = (a: ManutencaoAparelho) => {
    if (
      window.confirm(
        `Desconectar o celular de ${pessoa(a.nome, a.ponto)}? Ele deixa de receber avisos e precisará fazer login de novo.`,
      )
    ) {
      revogar.mutate(a.id);
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <Panel>
        <SectionTitle
          icon={Smartphone}
          title="Celulares com o app"
          count={aparelhos.length}
          description="Login feito uma única vez na instalação. Desconecte aparelhos perdidos ou de quem saiu da equipe."
          action={
            versao ? (
              <a href={manutencaoApkUrl()} download={versao.arquivo} className={sagraBtn("download", "sm")}>
                <Download className="h-4 w-4" aria-hidden />
                APK v{versao.version_name}
              </a>
            ) : (
              <Badge className="bg-amber-50 text-amber-800 ring-amber-200">APK ainda não publicado</Badge>
            )
          }
        />
        {aparelhos.length === 0 ? (
          <EmptyState
            icon={Smartphone}
            title="Nenhum celular conectado"
            description="Abra a página Manutenção no navegador do celular Android e toque em “Baixar app Android”."
          />
        ) : (
          <ul className="divide-y divide-slate-100 px-4">
            {aparelhos.map((a) => {
              const desatualizado =
                versao && a.versao_app && a.versao_app !== versao.version_name;
              return (
                <li key={a.id} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                    <Smartphone className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-800">{pessoa(a.nome, a.ponto)}</p>
                    <p className="text-xs text-slate-500">
                      {a.modelo || "Android"} · app v{a.versao_app || "?"} · instalado em{" "}
                      {formatDataHora(a.criado_em)}
                    </p>
                  </div>
                  <div className="text-right text-xs text-slate-500">
                    <p>
                      Abriu o app{" "}
                      <span className="font-medium text-slate-700">
                        {a.ultima_abertura_em ? tempoRelativo(a.ultima_abertura_em) : "nunca"}
                      </span>
                    </p>
                    <p>{a.aberturas_7d} abertura(s) em 7 dias</p>
                  </div>
                  {desatualizado ? (
                    <Badge className="bg-amber-50 text-amber-800 ring-amber-200">Atualizando…</Badge>
                  ) : null}
                  <button
                    type="button"
                    className={sagraBtn("delete-outline", "sm")}
                    onClick={() => desconectar(a)}
                    disabled={revogar.isPending}
                  >
                    <Unplug className="h-4 w-4" aria-hidden />
                    Desconectar
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel>
        <SectionTitle icon={History} title="Aberturas recentes do app" count={aberturas.length} />
        {aberturas.length === 0 ? (
          <p className="px-4 py-3 text-sm text-slate-500">Nenhuma abertura registrada ainda.</p>
        ) : (
          <ul className="max-h-[28rem] divide-y divide-slate-100 overflow-y-auto px-4">
            {aberturas.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 truncate text-slate-700">{pessoa(b.nome, b.ponto)}</span>
                <span className="shrink-0 text-xs text-slate-500">{formatDataHora(b.aberto_em)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
