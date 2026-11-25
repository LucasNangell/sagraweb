import { useQuery } from "@tanstack/react-query";
import { BellOff, Download, LogOut, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";

import { fetchManutencaoAppVersao, manutencaoKeys } from "@/api/manutencao";
import { sagraBtn } from "@/components/ui/sagraBtn";
import {
  isAndroidMobileBrowser,
  isSagraManutencaoApp,
  manutencaoApkUrl,
  sagraAppBridge,
} from "@/lib/sagraNativeApp";

export function formatTamanho(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

/**
 * Cabeçalho da Manutenção no celular:
 * - navegador Android → botão para baixar o APK;
 * - dentro do app → versão, aviso de notificações desativadas e "Sair".
 */
export function AppMobileAcoes() {
  if (isSagraManutencaoApp()) return <AcoesDentroDoApp />;
  if (isAndroidMobileBrowser()) return <BaixarApk />;
  return null;
}

function BaixarApk() {
  const versaoQ = useQuery({
    queryKey: manutencaoKeys.appVersao,
    queryFn: fetchManutencaoAppVersao,
    retry: false,
    staleTime: 10 * 60_000,
  });
  const v = versaoQ.data;
  if (!v) return null;
  return (
    <a
      href={manutencaoApkUrl()}
      download={v.arquivo}
      className="flex w-full items-center gap-3 rounded-xl bg-slate-900 px-4 py-3 text-white shadow-sm transition hover:bg-slate-800 sm:w-auto"
    >
      <Download className="h-5 w-5 shrink-0 text-amber-400" aria-hidden />
      <span className="min-w-0 text-left">
        <span className="block text-sm font-semibold">Baixar app Android</span>
        <span className="block text-xs text-slate-300">
          v{v.version_name} · {formatTamanho(v.tamanho)} · avisos com o app fechado
        </span>
      </span>
    </a>
  );
}

function AcoesDentroDoApp() {
  const bridge = sagraAppBridge();
  const [notif, setNotif] = useState(() => bridge?.statusNotificacoes() ?? "ativas");

  useEffect(() => {
    if (!bridge) return;
    const atualizar = () => {
      if (document.visibilityState === "visible") setNotif(bridge.statusNotificacoes());
    };
    document.addEventListener("visibilitychange", atualizar);
    return () => document.removeEventListener("visibilitychange", atualizar);
  }, [bridge]);

  if (!bridge) return null;

  const sair = () => {
    if (
      window.confirm(
        "Desconectar este celular? Você deixará de receber avisos e precisará fazer login novamente.",
      )
    ) {
      bridge.sair();
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {notif !== "ativas" ? (
        <button
          type="button"
          className={sagraBtn("primary", "sm")}
          onClick={() => bridge.abrirConfigNotificacoes()}
        >
          <BellOff className="h-4 w-4" aria-hidden />
          Ativar notificações
        </button>
      ) : null}
      <span className="inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-xs text-slate-500 ring-1 ring-slate-200">
        <Smartphone className="h-3.5 w-3.5" aria-hidden />
        App v{bridge.versao()}
      </span>
      <button type="button" className={sagraBtn("outline", "sm")} onClick={sair}>
        <LogOut className="h-4 w-4" aria-hidden />
        Sair
      </button>
    </div>
  );
}
