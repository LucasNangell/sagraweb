import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@sagra/ui";
import {
  BellRing,
  ClipboardList,
  HardHat,
  HelpCircle,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { manutencaoKeys } from "@/api/manutencao";
import { toast } from "@/components/ui/toastStore";
import { useAuthStore } from "@/features/auth/authStore";
import { useAccessControl } from "@/features/auth/useAccessControl";
import { usePainelOsManifest } from "@/components/pwa/usePainelOsManifest";
import { useSagraWebSocket } from "@/hooks/useSagraWebSocket";

import { GerenciaTab } from "./GerenciaTab";
import { OperadorTab } from "./OperadorTab";

type TabId = "gerencia" | "operador";

const HELP_KEY = "sagra.manutencao.help.dismissed";

interface ManutencaoWsMessage {
  type?: string;
  acao?: string;
  pedido_id?: number;
}

export function ManutencaoPage({
  initialTab,
  maquinaCodigo,
  pedidoId,
}: {
  initialTab?: TabId;
  maquinaCodigo?: string;
  pedidoId?: number;
}) {
  // PWA exclusivo: manifest, ícone e título próprios enquanto a página estiver aberta.
  usePainelOsManifest(true, "manutencao");
  const { can } = useAccessControl();
  const canGerencia = can("sb_manutencao_gerencia");
  const canOperador = can("sb_manutencao_operador");
  const ponto = useAuthStore((s) => s.user?.ponto);
  const queryClient = useQueryClient();

  const resolveTab = (wanted?: TabId): TabId => {
    if (wanted === "operador" && canOperador) return "operador";
    if (wanted === "gerencia" && canGerencia) return "gerencia";
    return canGerencia ? "gerencia" : "operador";
  };
  const [tab, setTab] = useState<TabId>(() => resolveTab(initialTab));
  useEffect(() => {
    setTab((cur) => resolveTab(initialTab ?? cur));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canGerencia, canOperador, initialTab]);

  const [showHelp, setShowHelp] = useState(() => {
    try {
      return localStorage.getItem(HELP_KEY) !== "1";
    } catch {
      return true;
    }
  });
  const closeHelp = () => {
    setShowHelp(false);
    try {
      localStorage.setItem(HELP_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  // Atualização em tempo real: qualquer mudança no módulo invalida os dados.
  const invalidateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useSagraWebSocket<ManutencaoWsMessage>({
    path: ponto ? `/ws?ponto=${encodeURIComponent(String(ponto))}` : "/ws",
    enabled: Boolean(ponto),
    onMessage: (data) => {
      if (data?.type !== "manutencao_changed") return;
      if (invalidateTimer.current) clearTimeout(invalidateTimer.current);
      invalidateTimer.current = setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: manutencaoKeys.all });
      }, 250);
      if (data.acao === "pedido_criado" && canOperador && tab !== "operador") {
        toast.warning("Nova manutenção na fila do operador");
      }
    },
  });
  useEffect(
    () => () => {
      if (invalidateTimer.current) clearTimeout(invalidateTimer.current);
    },
    [],
  );

  const tabs: Array<{ id: TabId; label: string; icon: typeof Wrench; hint: string }> = [];
  if (canGerencia) {
    tabs.push({
      id: "gerencia",
      label: "Gerência",
      icon: ClipboardList,
      hint: "Solicitar e priorizar",
    });
  }
  if (canOperador) {
    tabs.push({
      id: "operador",
      label: "Operador",
      icon: HardHat,
      hint: "Executar e concluir",
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-2 pb-10 pt-1 sm:px-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white shadow-sm">
              <Wrench className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
                Manutenção
              </h1>
              <p className="text-sm text-slate-500">
                Controle de manutenção das máquinas da Gráfica
              </p>
            </div>
          </div>
          {!showHelp ? (
            <button
              type="button"
              onClick={() => setShowHelp(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 shadow-sm hover:bg-slate-50"
            >
              <HelpCircle className="h-4 w-4" aria-hidden />
              Como funciona
            </button>
          ) : null}
        </header>

        {showHelp ? <ComoFunciona onClose={closeHelp} /> : null}

        {tabs.length > 1 ? (
          <nav
            className="grid grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1 sm:inline-grid sm:w-auto sm:self-start"
            aria-label="Abas da Manutenção"
          >
            {tabs.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition sm:min-w-[11rem]",
                    active
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-500 hover:text-slate-800",
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  <span>{t.label}</span>
                  <span className="hidden text-xs font-normal text-slate-400 lg:inline">
                    · {t.hint}
                  </span>
                </button>
              );
            })}
          </nav>
        ) : null}

        {tab === "gerencia" && canGerencia ? (
          <GerenciaTab maquinaCodigo={maquinaCodigo} pedidoId={pedidoId} />
        ) : null}
        {tab === "operador" && canOperador ? (
          <OperadorTab
            maquinaCodigo={maquinaCodigo}
            pedidoId={pedidoId}
            ponto={ponto ? String(ponto) : ""}
          />
        ) : null}
      </div>
    </div>
  );
}

function ComoFunciona({ onClose }: { onClose: () => void }) {
  const steps = [
    {
      icon: ClipboardList,
      title: "1. Gerência solicita",
      text: "Escolha a máquina, descreva o que deve ser feito (ou use uma manutenção recorrente) e defina a prioridade.",
    },
    {
      icon: BellRing,
      title: "2. Operador é avisado",
      text: "O pedido entra na fila e os operadores recebem uma notificação. A gerência pode reordenar a fila a qualquer momento.",
    },
    {
      icon: HardHat,
      title: "3. Operador executa",
      text: "Ao iniciar, o operador detalha o problema e registra o passo a passo da solução. Pode pausar (ex.: aguardando peça).",
    },
    {
      icon: Wrench,
      title: "4. Conclusão registrada",
      text: "Concluído, o histórico fica salvo na máquina e quem solicitou é notificado.",
    },
  ];
  return (
    <div className="relative rounded-xl border border-sky-200 bg-gradient-to-br from-sky-50 to-white p-4 shadow-sm">
      <button
        type="button"
        onClick={onClose}
        className="absolute right-2 top-2 rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-slate-700"
        aria-label="Fechar guia"
      >
        <X className="h-4 w-4" />
      </button>
      <p className="mb-3 pr-8 text-sm font-semibold text-sky-900">Como funciona a Manutenção</p>
      <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {steps.map((s) => {
          const Icon = s.icon;
          return (
            <li key={s.title} className="flex gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-sky-700 shadow-sm ring-1 ring-sky-100">
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-800">{s.title}</p>
                <p className="text-xs leading-relaxed text-slate-600">{s.text}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
