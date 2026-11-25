import { cn } from "@sagra/ui";
import {
  BellOff,
  BellRing,
  CheckCircle2,
  Download,
  Loader2,
  Send,
  Share,
  Smartphone,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { testarManutencaoPush } from "@/api/manutencao";
import { sagraBtn } from "@/components/ui/sagraBtn";
import { toast } from "@/components/ui/toastStore";
import { useWebPush } from "@/hooks/useWebPush";
import { appScope, getNotificationSupport } from "@/lib/nativeNotification";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type PushEstado =
  | "carregando"
  | "sem-suporte"
  | "inseguro"
  | "ios-instalar"
  | "bloqueado"
  | "desativado"
  | "ativo";

const COLLAPSE_KEY = "sagra.manutencao.push.card.min";

export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

export function isIosDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // iPadOS 13+ se identifica como Mac com touch.
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** Estado das notificações push neste aparelho (sem pedir permissão). */
export async function detectarPushEstado(): Promise<PushEstado> {
  const support = getNotificationSupport();
  if (support === "insecure-context") return "inseguro";
  const temPush = typeof window !== "undefined" && "PushManager" in window && "serviceWorker" in navigator;
  if (!temPush || support === "unsupported") {
    // No iPhone/iPad o push só existe com o app instalado na Tela de Início.
    if (isIosDevice() && !isStandaloneDisplay()) return "ios-instalar";
    return "sem-suporte";
  }
  if (support === "denied") return "bloqueado";
  if (support !== "granted") return "desativado";
  try {
    const reg = await Promise.race([
      navigator.serviceWorker.getRegistration(appScope()),
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 2500)),
    ]);
    const sub = await reg?.pushManager?.getSubscription();
    return sub ? "ativo" : "desativado";
  } catch {
    return "desativado";
  }
}

function useInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [instalado, setInstalado] = useState(isStandaloneDisplay);

  useEffect(() => {
    const onBefore = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalado(true);
      setDeferred(null);
    };
    window.addEventListener("beforeinstallprompt", onBefore);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBefore);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const instalar = useCallback(async () => {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    setDeferred(null);
    if (choice.outcome === "accepted") {
      toast.success("App Manutenção instalado");
    }
  }, [deferred]);

  return { podeInstalar: Boolean(deferred), instalado, instalar };
}

const ESTADO_META: Record<
  Exclude<PushEstado, "carregando">,
  { titulo: string; texto: string; tom: "ok" | "aviso" | "neutro" | "erro" }
> = {
  ativo: {
    titulo: "Notificações ativas neste aparelho",
    texto: "Você recebe um aviso quando chegar um novo pedido, mesmo com o app fechado.",
    tom: "ok",
  },
  desativado: {
    titulo: "Receba avisos de novos pedidos",
    texto:
      "Ative as notificações para ser avisado no celular quando a gerência abrir um pedido — mesmo com o app fechado.",
    tom: "aviso",
  },
  bloqueado: {
    titulo: "Notificações bloqueadas",
    texto:
      "O navegador está bloqueando avisos do SAGRA. Toque no cadeado da barra de endereço (ou nas configurações do app) → Notificações → Permitir, e volte aqui.",
    tom: "erro",
  },
  "ios-instalar": {
    titulo: "Instale o app para receber avisos",
    texto:
      "No iPhone/iPad as notificações só funcionam com o app na Tela de Início: toque em Compartilhar e depois em “Adicionar à Tela de Início”. Abra pelo ícone e ative aqui.",
    tom: "aviso",
  },
  inseguro: {
    titulo: "Conexão sem HTTPS",
    texto:
      "Notificações exigem conexão segura. Acesse o SAGRA pelo endereço https:// para ativá-las.",
    tom: "neutro",
  },
  "sem-suporte": {
    titulo: "Navegador sem suporte a notificações",
    texto: "Use o Chrome (Android) ou instale o app pela Tela de Início (iPhone) para receber avisos.",
    tom: "neutro",
  },
};

const TOM_CLASS: Record<"ok" | "aviso" | "neutro" | "erro", string> = {
  ok: "border-emerald-200 bg-emerald-50",
  aviso: "border-amber-300 bg-amber-50",
  neutro: "border-slate-200 bg-white",
  erro: "border-red-200 bg-red-50",
};

/**
 * Cartão do operador: instalar o app Manutenção (PWA) e ativar Web Push
 * para receber novos pedidos com o app fechado.
 */
export function ManutencaoNotificacoesCard() {
  const { requestBrowserPush } = useWebPush();
  const { podeInstalar, instalado, instalar } = useInstallPrompt();
  const [estado, setEstado] = useState<PushEstado>("carregando");
  const [ativando, setAtivando] = useState(false);
  const [testando, setTestando] = useState(false);
  const [minimizado, setMinimizado] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const sincronizado = useRef(false);

  const atualizar = useCallback(async () => {
    setEstado(await detectarPushEstado());
  }, []);

  useEffect(() => {
    void atualizar();
    const onVisible = () => {
      if (document.visibilityState === "visible") void atualizar();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [atualizar]);

  // Já ativo: reenvia a inscrição ao servidor uma vez (vincula ao ponto da sessão
  // e recupera inscrições removidas após expirar).
  useEffect(() => {
    if (estado !== "ativo" || sincronizado.current) return;
    sincronizado.current = true;
    void requestBrowserPush().catch(() => undefined);
  }, [estado, requestBrowserPush]);

  const ativar = async () => {
    setAtivando(true);
    try {
      const r = await requestBrowserPush();
      if (r.permission && r.push === "ok") {
        sincronizado.current = true;
        toast.success("Notificações ativadas neste aparelho");
      } else if (r.permission) {
        toast.error(`Não foi possível ativar o push${r.reason ? `: ${r.reason}` : ""}`);
      }
    } finally {
      setAtivando(false);
      void atualizar();
    }
  };

  const testar = async () => {
    setTestando(true);
    try {
      const r = await testarManutencaoPush();
      if (r.enviados > 0) {
        toast.success("Notificação de teste enviada — confira a barra de notificações");
      } else {
        toast.warning(
          "Nenhum aparelho inscrito recebeu o teste. Toque em “Ativar notificações” novamente.",
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao enviar teste");
    } finally {
      setTestando(false);
    }
  };

  const setMin = (v: boolean) => {
    setMinimizado(v);
    try {
      localStorage.setItem(COLLAPSE_KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  if (estado === "carregando") return null;
  const meta = ESTADO_META[estado];
  const mostrarInstalar = !instalado && (podeInstalar || isIosDevice());

  if (estado === "ativo" && minimizado) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
        <BellRing className="h-4 w-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate font-medium">Notificações ativas neste aparelho</span>
        <button
          type="button"
          className="rounded-md px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
          onClick={() => void testar()}
          disabled={testando}
        >
          {testando ? "Enviando…" : "Testar"}
        </button>
        <button
          type="button"
          className="rounded-md px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
          onClick={() => setMin(false)}
        >
          Detalhes
        </button>
      </div>
    );
  }

  const Icone = estado === "ativo" ? CheckCircle2 : estado === "bloqueado" ? BellOff : estado === "ios-instalar" ? Smartphone : BellRing;

  return (
    <section
      className={cn("rounded-xl border p-4 shadow-sm", TOM_CLASS[meta.tom])}
      aria-label="Notificações no celular"
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
            meta.tom === "ok" && "bg-emerald-600 text-white",
            meta.tom === "aviso" && "bg-amber-500 text-slate-900",
            meta.tom === "erro" && "bg-red-600 text-white",
            meta.tom === "neutro" && "bg-slate-200 text-slate-600",
          )}
        >
          <Icone className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-900">{meta.titulo}</p>
          <p className="mt-0.5 text-sm text-slate-600">{meta.texto}</p>

          <div className="mt-3 flex flex-wrap gap-2">
            {estado === "desativado" || estado === "bloqueado" ? (
              <button
                type="button"
                className={sagraBtn("primary", "md")}
                onClick={() => void ativar()}
                disabled={ativando}
              >
                {ativando ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <BellRing className="h-4 w-4" aria-hidden />
                )}
                {ativando ? "Ativando…" : estado === "bloqueado" ? "Tentar novamente" : "Ativar notificações"}
              </button>
            ) : null}
            {estado === "ativo" ? (
              <button
                type="button"
                className={sagraBtn("outline", "sm")}
                onClick={() => void testar()}
                disabled={testando}
              >
                <Send className="h-4 w-4" aria-hidden />
                {testando ? "Enviando…" : "Enviar notificação de teste"}
              </button>
            ) : null}
            {mostrarInstalar && podeInstalar ? (
              <button type="button" className={sagraBtn("outline", "sm")} onClick={() => void instalar()}>
                <Download className="h-4 w-4" aria-hidden />
                Instalar app Manutenção
              </button>
            ) : null}
            {mostrarInstalar && !podeInstalar && estado !== "ios-instalar" ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/70 px-2.5 py-1.5 text-xs text-slate-600 ring-1 ring-slate-200">
                <Share className="h-3.5 w-3.5" aria-hidden />
                Dica: Compartilhar → “Adicionar à Tela de Início” cria o app Manutenção
              </span>
            ) : null}
          </div>
        </div>
        {estado === "ativo" ? (
          <button
            type="button"
            className="rounded-lg p-1.5 text-slate-500 hover:bg-black/5 hover:text-slate-700"
            onClick={() => setMin(true)}
            aria-label="Minimizar aviso de notificações"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    </section>
  );
}
