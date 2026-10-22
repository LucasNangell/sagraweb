import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { fetchNotifications, markNotificationRead } from "@/api/notifications";
import { queryKeys } from "@/api/query-keys";
import { useAuthStore } from "@/features/auth/authStore";
import {
  shouldSuppressGravacaoExternaNotification,
} from "@/features/gravacao-externa/gravacaoExternaUiStore";
import {
  extractGravacaoOsFromWs,
  handleGravacaoExternaMensagemWs,
  type GravacaoExternaWsPayload,
} from "@/features/gravacao-externa/utils/gravacaoExternaNotificationHandlers";
import { shouldSuppressSupportNotification } from "@/features/support/supportUiStore";
import {
  handleSupportNotificationAction,
  supportNotificationDetailsFromWs,
} from "@/features/support/utils/supportNotificationHandlers";
import { useSagraWebSocket } from "@/hooks/useSagraWebSocket";
import {
  markNativeNotificationShown,
  showNativeNotification,
  wasNativeNotificationShown,
} from "@/lib/nativeNotification";
import type { AppNotification } from "../types";
import {
  isOsWatchNotification,
  parseOsWatchDetalhes,
  selectOsWatchCatchUp,
} from "../osWatchNativeCatchUp";

interface NotificationWsMessage extends GravacaoExternaWsPayload {
  target_ponto?: string;
  target_user?: string;
  mensagem?: string;
  notification_id?: number;
  ticket_id?: number;
  support_message_id?: number;
  browser_notify?: boolean;
  urgent?: boolean;
}

const OS_WATCH_ACTIONS = new Set(["os_watch_andamento", "os_watch_change"]);

function cleanPonto(value: string | number | null | undefined): string {
  return String(value ?? "").replace(/\D/g, "");
}

function isSupportPopupSkipped(notification: AppNotification): boolean {
  const detalhes = parseOsWatchDetalhes(notification);
  if (!detalhes?.type && !detalhes?.tipo) {
    return false;
  }
  if (shouldSuppressSupportNotification(detalhes)) {
    return true;
  }
  if (shouldSuppressGravacaoExternaNotification(detalhes)) {
    return true;
  }
  return (
    detalhes.type === "support_reply" ||
    detalhes.type === "cliente_support" ||
    detalhes.type === "support_incoming"
  );
}

function isNotificationForUser(
  data: NotificationWsMessage,
  ponto: string | null,
): boolean {
  if (!ponto) {
    return false;
  }
  const target = data.target_ponto ?? data.target_user;
  if (!target) {
    return true;
  }
  const targetDigits = cleanPonto(target);
  const userDigits = cleanPonto(ponto);
  return Boolean(targetDigits && userDigits && targetDigits === userDigits);
}

function hasOsRef(nro: number | null | undefined, ano: number | null | undefined): boolean {
  return nro != null && nro > 0 && ano != null && ano > 0;
}

async function showOsWatchNativeToast(
  data: NotificationWsMessage,
): Promise<void> {
  const mensagem = data.mensagem?.trim() || "Nova atualização na OS.";
  const nro = data.id ?? null;
  const ano = data.ano ?? null;
  const osKnown = hasOsRef(nro, ano);
  const urgent = Boolean(data.urgent);
  const title = urgent
    ? osKnown
      ? `OS ${nro}/${ano} - ERRO`
      : "SAGRA Web - ERRO"
    : osKnown
      ? `OS ${nro}/${ano}`
      : "SAGRA Web";

  await showNativeNotification({
    title,
    body: mensagem,
    tag:
      data.notification_id && data.notification_id > 0
        ? `sagra-notif-${data.notification_id}`
        : osKnown
          ? `os-${nro}-${ano}`
          : `os-watch-${Date.now()}`,
    nro: osKnown ? nro : null,
    ano: osKnown ? ano : null,
    notificationId: data.notification_id ?? null,
    urgent,
  });
}

function showCatchUpToasts(items: AppNotification[]): void {
  const plan = selectOsWatchCatchUp(items, wasNativeNotificationShown);
  if (plan.kind === "none") {
    return;
  }
  if (plan.kind === "summary") {
    void showNativeNotification({
      title: "SAGRA Web",
      body: `${plan.items.length} atualizações em OS acompanhadas`,
      tag: "sagra-os-watch-summary",
      openNotificationCenter: true,
    }).then((ok) => {
      if (!ok) {
        return;
      }
      for (const item of plan.items) {
        markNativeNotificationShown(item.Id);
      }
    });
    return;
  }
  for (const item of plan.items) {
    const nro = item.NroProtocolo ?? null;
    const ano = item.AnoProtocolo ?? null;
    const osKnown = hasOsRef(nro, ano);
    const urgent = Boolean(parseOsWatchDetalhes(item)?.urgent);
    void showNativeNotification({
      title: urgent
        ? osKnown
          ? `OS ${nro}/${ano} - ERRO`
          : "SAGRA Web - ERRO"
        : osKnown
          ? `OS ${nro}/${ano}`
          : "SAGRA Web",
      body: item.Mensagem?.trim() || "Nova atualização na OS.",
      nro: osKnown ? nro : null,
      ano: osKnown ? ano : null,
      notificationId: item.Id,
      urgent,
    });
  }
}

export function OsNotificationHandler() {
  const user = useAuthStore((s) => s.user);
  const ponto = user?.ponto != null ? String(user.ponto) : null;
  const queryClient = useQueryClient();
  const [active, setActive] = useState<AppNotification | null>(null);
  const activeRef = useRef<AppNotification | null>(null);
  const [catchUpNonce, setCatchUpNonce] = useState(0);
  const lastCatchUpNonceRef = useRef(-1);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const showNotification = useCallback((notification: AppNotification) => {
    if (activeRef.current || isSupportPopupSkipped(notification)) {
      return;
    }
    if (isOsWatchNotification(notification)) {
      return;
    }
    setActive(notification);
  }, []);

  const showLatestUnread = useCallback(async () => {
    if (!ponto) {
      return;
    }
    try {
      const list = await fetchNotifications(ponto);
      queryClient.setQueryData(queryKeys.notifications(ponto), list);
      const next = list.find(
        (item) => !isSupportPopupSkipped(item) && !isOsWatchNotification(item),
      );
      if (next) {
        showNotification(next);
      }
    } catch {
      /* ignore */
    }
  }, [ponto, queryClient, showNotification]);

  const notificationsQuery = useQuery({
    queryKey: ponto
      ? queryKeys.notifications(ponto)
      : ["notifications", "idle"],
    queryFn: () => fetchNotifications(ponto!),
    enabled: Boolean(ponto),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    const list = notificationsQuery.data;
    if (list && list.length > 0) {
      const next = list.find(
        (item) => !isSupportPopupSkipped(item) && !isOsWatchNotification(item),
      );
      if (next) {
        showNotification(next);
      }
    }
  }, [notificationsQuery.data, showNotification]);

  useEffect(() => {
    if (!notificationsQuery.isSuccess) {
      return;
    }
    if (lastCatchUpNonceRef.current === catchUpNonce) {
      return;
    }
    lastCatchUpNonceRef.current = catchUpNonce;
    showCatchUpToasts(notificationsQuery.data ?? []);
  }, [catchUpNonce, notificationsQuery.data, notificationsQuery.isSuccess]);

  const wsPath = ponto ? `/ws?ponto=${encodeURIComponent(ponto)}` : "/ws";

  useSagraWebSocket<NotificationWsMessage>({
    path: wsPath,
    enabled: Boolean(ponto),
    onOpen: () => {
      setCatchUpNonce((value) => value + 1);
      if (ponto) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.notifications(ponto),
        });
      }
    },
    onMessage: (data) => {
      if (data.type !== "notification_new") {
        return;
      }
      if (!isNotificationForUser(data, ponto)) {
        return;
      }

      if (
        data.action === "support_reply" ||
        data.action === "cliente_support" ||
        data.action === "support_incoming"
      ) {
        const wsDetalhes = supportNotificationDetailsFromWs(data);
        void handleSupportNotificationAction(queryClient, ponto, data);
        if (shouldSuppressSupportNotification(wsDetalhes)) {
          void queryClient.invalidateQueries({
            queryKey: queryKeys.notifications(ponto),
          });
        }
        return;
      }

      if (data.action === "gravacao_externa_mensagem") {
        const os = extractGravacaoOsFromWs(data);
        const suppressed =
          os != null &&
          shouldSuppressGravacaoExternaNotification({
            tipo: "gravacao_externa_mensagem",
            os_ano: os.ano,
            os_nro: os.nrOs,
          });

        if (!suppressed) {
          void handleGravacaoExternaMensagemWs(queryClient, data, { forceRefresh: true });
        }

        if (suppressed) {
          if (data.notification_id && data.notification_id > 0) {
            void markNotificationRead(data.notification_id).catch(() => undefined);
          }
          void queryClient.invalidateQueries({
            queryKey: queryKeys.notifications(ponto),
          });
          return;
        }
      }

      if (data.action && OS_WATCH_ACTIONS.has(data.action)) {
        if (data.browser_notify === true) {
          void showOsWatchNativeToast(data);
        }
        void queryClient.invalidateQueries({
          queryKey: queryKeys.notifications(ponto),
        });
        return;
      }

      const mensagem = data.mensagem?.trim();
      if (mensagem) {
        showNotification({
          Id: data.notification_id ?? 0,
          Mensagem: mensagem,
          NroProtocolo: data.id ?? null,
          AnoProtocolo: data.ano ?? null,
        });
      }

      void showLatestUnread();
    },
  });

  const dismiss = async () => {
    if (!active || !ponto) {
      return;
    }
    try {
      let id = active.Id;
      if (!id || id <= 0) {
        const list = await fetchNotifications(ponto);
        const match =
          list.find((item) => item.Mensagem === active.Mensagem) ?? list[0];
        id = match?.Id ?? 0;
      }
      if (id > 0) {
        await markNotificationRead(id);
      }
    } catch {
      /* ignore */
    }
    setActive(null);
    await queryClient.invalidateQueries({
      queryKey: queryKeys.notifications(ponto),
    });
  };

  if (!active) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[10004] flex items-center justify-center bg-black/60 p-4"
      role="alertdialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-lg border-t-4 border-secondary-blue bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-secondary-blue">Notificação</h3>
        <p className="mt-3 whitespace-pre-wrap text-sm text-neutral-800">
          {active.Mensagem ?? "Nova notificação"}
        </p>
        {(active.NroProtocolo != null || active.AnoProtocolo != null) && (
          <p className="mt-2 text-xs text-neutral-500">
            OS {active.NroProtocolo}/{active.AnoProtocolo}
          </p>
        )}
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={() => void dismiss()}
            className="rounded bg-primary-green px-4 py-2 text-sm font-semibold text-white"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
