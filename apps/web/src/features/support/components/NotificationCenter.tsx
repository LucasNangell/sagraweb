import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Bell, X } from "lucide-react";

import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";

import { fetchNotifications, markNotificationRead } from "@/api/notifications";

import { queryKeys } from "@/api/query-keys";

import { useAuthStore } from "@/features/auth/authStore";

import type { AppNotification } from "@/features/os/types";

import {
  shouldSuppressSupportNotification,
  useSupportUiStore,
} from "@/features/support/supportUiStore";

import { handleSupportNotificationAction, supportNotificationDetailsFromWs } from "@/features/support/utils/supportNotificationHandlers";

import { useSagraWebSocket } from "@/hooks/useSagraWebSocket";

import { cn } from "@sagra/ui";

import { homeTestIds } from "@/lib/testId";



interface NotificationWsMessage {

  type?: string;

  target_ponto?: string;

  target_user?: string;

  action?: string;

  ticket_id?: number;

  support_message_id?: number;

}



interface SupportReplyDetails {

  type?: string;

  support_message_id?: number;

  ticket_id?: number;

  assunto?: string;

  resposta?: string;

  mensagem?: string;

  tipo?: string;

  os_nro?: number;

  os_ano?: number;

}



function cleanPonto(value: string | number | null | undefined): string {

  return String(value ?? "").replace(/\D/g, "");

}



function parseDetalhes(json: string | null | undefined): SupportReplyDetails | null {

  if (!json?.trim()) {

    return null;

  }

  try {

    return JSON.parse(json) as SupportReplyDetails;

  } catch {

    return null;

  }

}



function isSupportReply(notification: AppNotification): boolean {

  const detalhes = parseDetalhes(notification.DetalhesJson);

  return detalhes?.type === "support_reply";

}



function isClienteSupport(notification: AppNotification): boolean {

  const detalhes = parseDetalhes(notification.DetalhesJson);

  return detalhes?.type === "cliente_support";

}



function isSupportIncoming(notification: AppNotification): boolean {

  const detalhes = parseDetalhes(notification.DetalhesJson);

  return detalhes?.type === "support_incoming";

}



function isChatNotification(notification: AppNotification): boolean {

  return (

    isSupportReply(notification) ||

    isClienteSupport(notification) ||

    isSupportIncoming(notification)

  );

}



function isVisibleChatNotification(notification: AppNotification): boolean {

  if (!isChatNotification(notification)) {

    return false;

  }

  return !shouldSuppressSupportNotification(parseDetalhes(notification.DetalhesJson));

}



function formatDate(value: string | null | undefined): string {

  if (!value) {

    return "";

  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("pt-BR");

}



export function NotificationCenter() {

  const user = useAuthStore((s) => s.user);

  const ponto = user?.ponto != null ? String(user.ponto) : null;

  const queryClient = useQueryClient();

  const navigate = useNavigate();

  const openSupportModal = useSupportUiStore((s) => s.openModal);
  const viewingTickets = useSupportUiStore((s) => s.viewingTickets);

  const [panelOpen, setPanelOpen] = useState(false);

  const [selected, setSelected] = useState<AppNotification | null>(null);

  const [persistentAlert, setPersistentAlert] = useState<AppNotification | null>(null);

  const dismissedAlertIdsRef = useRef<Set<number>>(new Set());

  const rootRef = useRef<HTMLDivElement>(null);



  const notificationsQuery = useQuery({

    queryKey: ponto ? queryKeys.notifications(ponto) : ["notifications", "idle"],

    queryFn: () => fetchNotifications(ponto!),

    enabled: Boolean(ponto),

    staleTime: 0,

    refetchOnWindowFocus: true,

  });



  const visibleChatNotifications = (notificationsQuery.data ?? []).filter(

    isVisibleChatNotification,

  );

  const unreadCount = visibleChatNotifications.length;



  const wsPath = ponto ? `/ws?ponto=${encodeURIComponent(ponto)}` : "/ws";



  const syncNotifications = useCallback(async () => {

    if (!ponto) {

      return [];

    }

    let list = await fetchNotifications(ponto);

    let markedAny = false;

    for (const item of list) {

      if (

        shouldSuppressSupportNotification(parseDetalhes(item.DetalhesJson)) &&

        item.Id > 0

      ) {

        try {

          await markNotificationRead(item.Id);

          markedAny = true;

        } catch {

          /* ignore */

        }

      }

    }

    if (markedAny) {

      list = await fetchNotifications(ponto);

    }

    queryClient.setQueryData(queryKeys.notifications(ponto), list);

    return list;

  }, [ponto, queryClient]);

  const refreshAndShowAlert = useCallback(async () => {

    try {

      const list = await syncNotifications();

      const next = list.find(

        (item) =>

          isVisibleChatNotification(item) &&

          !dismissedAlertIdsRef.current.has(item.Id),

      );

      if (next) {

        setPersistentAlert(next);

      }

    } catch {

      /* ignore */

    }

  }, [syncNotifications]);



  useSagraWebSocket<NotificationWsMessage>({

    path: wsPath,

    enabled: Boolean(ponto),

    onMessage: (data) => {

      if (data.type !== "notification_new") {

        return;

      }

      const target = data.target_ponto ?? data.target_user;

      if (target && ponto && cleanPonto(target) !== cleanPonto(ponto)) {

        return;

      }

      const isChatAction =

        data.action === "support_reply" ||

        data.action === "cliente_support" ||

        data.action === "support_incoming";

      if (!isChatAction) {

        return;

      }

      const wsDetalhes = supportNotificationDetailsFromWs(data);
      const suppressed = shouldSuppressSupportNotification(wsDetalhes);

      void handleSupportNotificationAction(queryClient, ponto, data);

      if (suppressed) {
        void syncNotifications();
        return;
      }

      void refreshAndShowAlert();

    },

  });



  useEffect(() => {

    if (!ponto) {

      return;

    }

    void syncNotifications();

  }, [ponto, viewingTickets, syncNotifications]);

  useEffect(() => {

    if (!panelOpen) {

      return;

    }

    const onDocClick = (e: MouseEvent) => {

      if (!rootRef.current?.contains(e.target as Node)) {

        setPanelOpen(false);

      }

    };

    document.addEventListener("mousedown", onDocClick);

    return () => document.removeEventListener("mousedown", onDocClick);

  }, [panelOpen]);



  const openNotification = useCallback((notification: AppNotification) => {

    if (notification.Id > 0) {

      dismissedAlertIdsRef.current.add(notification.Id);

    }

    setSelected(notification);

    setPanelOpen(false);

    setPersistentAlert(null);

  }, []);



  const dismissPersistent = useCallback(() => {

    if (persistentAlert?.Id) {

      dismissedAlertIdsRef.current.add(persistentAlert.Id);

    }

    setPersistentAlert(null);

  }, [persistentAlert]);



  const openSupportFromNotification = useCallback(

    (detalhes: SupportReplyDetails | null) => {

      const ticketId = detalhes?.ticket_id ?? detalhes?.support_message_id ?? null;

      if (!ticketId) {

        return;

      }

      if (detalhes?.type === "support_incoming") {

        void navigate({

          to: "/admin/mensagens",

          search: { ticket: ticketId },

        });

        return;

      }

      const kind = detalhes?.type === "cliente_support" ? "assigned" : "internal";

      if (kind === "internal") {
        void navigate({
          to: "/mensagens",
          search: { ticket: ticketId },
        });
        return;
      }

      openSupportModal(ticketId, kind);

    },

    [navigate, openSupportModal],

  );



  const dismissSelected = async () => {

    if (!selected || !ponto) {

      setSelected(null);

      return;

    }

    try {

      if (selected.Id > 0) {

        await markNotificationRead(selected.Id);

      }

    } catch {

      /* ignore */

    }

    if (selected.Id > 0) {

      dismissedAlertIdsRef.current.add(selected.Id);

    }

    setSelected(null);

    setPersistentAlert(null);

    await queryClient.invalidateQueries({

      queryKey: queryKeys.notifications(ponto),

    });

  };



  if (!ponto) {

    return null;

  }



  const detalhes = selected ? parseDetalhes(selected.DetalhesJson) : null;

  const alertDetalhes = persistentAlert

    ? parseDetalhes(persistentAlert.DetalhesJson)

    : null;



  return (

    <>

      <div ref={rootRef} className="relative">

        <button

          type="button"

          onClick={() => setPanelOpen((v) => !v)}

          className="relative hidden rounded-full p-2 hover:bg-white/10 sm:inline-flex"

          aria-label="Notificações"
          data-testid={homeTestIds.headerNotifications}

          aria-expanded={panelOpen}

          title="Notificações"

        >

          <Bell className="size-5" />

          {unreadCount > 0 ? (

            <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-primary-green px-1 text-[10px] font-bold">

              {unreadCount > 9 ? "9+" : unreadCount}

            </span>

          ) : null}

        </button>



        {persistentAlert ? (

          <div

            className="absolute right-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-1.5rem)] rounded-lg border border-primary-green/40 bg-white p-3 text-slate-800 shadow-lg"

            role="status"

            aria-live="polite"

          >

            <div className="mb-1 flex items-start justify-between gap-2">

              <p className="text-xs font-semibold uppercase tracking-wide text-primary-green">

                Nova notificação

              </p>

              <button

                type="button"

                onClick={dismissPersistent}

                className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"

                aria-label="Dispensar aviso"
                data-testid={homeTestIds.headerNotificationsDismiss}

              >

                <X className="size-4" />

              </button>

            </div>

            <p className="line-clamp-3 text-sm text-slate-700">

              {persistentAlert.Mensagem ?? "Nova notificação"}

            </p>

            <div className="mt-2 flex gap-2">

              <button

                type="button"
                data-testid={homeTestIds.headerNotificationsOpen}

                onClick={() => openNotification(persistentAlert)}

                className="rounded-md bg-primary-green px-3 py-1.5 text-xs font-semibold text-white"

              >

                Abrir

              </button>

              {(isSupportReply(persistentAlert) ||

                isClienteSupport(persistentAlert) ||

                isSupportIncoming(persistentAlert)) &&

              alertDetalhes ? (

                <button

                  type="button"
                  data-testid={homeTestIds.headerNotificationsConversation}

                  onClick={() => {

                    dismissPersistent();

                    openSupportFromNotification(alertDetalhes);

                  }}

                  className="rounded-md border border-secondary-blue px-3 py-1.5 text-xs font-medium text-secondary-blue hover:bg-secondary-blue/5"

                >

                  {isSupportIncoming(persistentAlert) ? "Ver mensagens" : "Ver conversa"}

                </button>

              ) : null}

            </div>

          </div>

        ) : null}



        {panelOpen ? (

          <div

            className={cn(

              "absolute right-0 z-50 w-80 max-w-[calc(100vw-1.5rem)] rounded-md border border-slate-200 bg-white text-slate-800 shadow-xl",

              persistentAlert ? "top-[calc(100%+7.5rem)]" : "top-full mt-2",

            )}

          >

            <div className="border-b border-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">

              Notificações

            </div>

            {notificationsQuery.isLoading ? (

              <p className="px-3 py-4 text-sm text-slate-500">Carregando…</p>

            ) : unreadCount === 0 ? (

              <p className="px-3 py-4 text-sm text-slate-500">Nenhuma notificação pendente.</p>

            ) : (

              <ul className="max-h-72 overflow-y-auto">

                {visibleChatNotifications.map((item) => (

                  <li key={item.Id}>

                    <button

                      type="button"
                      data-testid={homeTestIds.headerNotificationItem(item.Id)}

                      onClick={() => openNotification(item)}

                      className="w-full border-b border-slate-50 px-3 py-2.5 text-left text-sm hover:bg-slate-50"

                    >

                      <span className="line-clamp-2 font-medium text-slate-800">

                        {item.Mensagem ?? "Nova notificação"}

                      </span>

                      {item.DataCriacao ? (

                        <span className="mt-0.5 block text-xs text-slate-500">

                          {formatDate(item.DataCriacao)}

                        </span>

                      ) : null}

                    </button>

                  </li>

                ))}

              </ul>

            )}

          </div>

        ) : null}

      </div>



      {selected ? (

        <div

          className="fixed inset-0 z-[10005] flex items-center justify-center bg-black/60 p-4"

          role="dialog"

          aria-modal="true"

          aria-labelledby="notification-detail-title"
          data-testid={homeTestIds.headerNotificationDetail}

        >

          <div className="w-full max-w-lg rounded-lg bg-white shadow-xl">

            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">

              <h2

                id="notification-detail-title"

                className="text-base font-semibold text-slate-800"

              >

                {isClienteSupport(selected)

                  ? "Dúvida do cliente"

                  : isSupportIncoming(selected)

                    ? "Mensagem ao suporte"

                    : isSupportReply(selected)

                      ? "Resposta do suporte"

                      : "Notificação"}

              </h2>

              <button

                type="button"

                onClick={() => void dismissSelected()}

                className="rounded p-1 text-slate-500 hover:bg-slate-100"

                aria-label="Fechar"
                data-testid={homeTestIds.headerNotificationDetailClose}

              >

                <X className="size-5" />

              </button>

            </div>

            <div className="space-y-3 p-4 text-sm text-slate-700">

              <p className="whitespace-pre-wrap">{selected.Mensagem}</p>

              {detalhes?.type === "support_reply" && detalhes.resposta ? (

                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">

                  {detalhes.assunto ? (

                    <p className="mb-2 font-medium text-slate-800">

                      Assunto: {detalhes.assunto}

                    </p>

                  ) : null}

                  <p className="whitespace-pre-wrap text-slate-700">{detalhes.resposta}</p>

                </div>

              ) : null}

              {detalhes?.type === "cliente_support" && detalhes.resposta ? (

                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">

                  <p className="whitespace-pre-wrap text-slate-700">{detalhes.resposta}</p>

                </div>

              ) : null}

              {detalhes?.type === "support_incoming" && detalhes.mensagem ? (

                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">

                  {detalhes.assunto ? (

                    <p className="mb-2 font-medium text-slate-800">

                      Assunto: {detalhes.assunto}

                    </p>

                  ) : null}

                  <p className="whitespace-pre-wrap text-slate-700">{detalhes.mensagem}</p>

                </div>

              ) : null}

              {(selected.NroProtocolo != null || selected.AnoProtocolo != null) &&

              (selected.NroProtocolo ?? 0) > 0 ? (

                <p className="text-xs text-slate-500">

                  OS {selected.NroProtocolo}/{selected.AnoProtocolo}

                </p>

              ) : null}

            </div>

            <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3">

              {(isSupportReply(selected) ||

                isClienteSupport(selected) ||

                isSupportIncoming(selected)) &&

              detalhes ? (

                <button

                  type="button"
                  data-testid={homeTestIds.headerNotificationDetailConversation}

                  onClick={() => {

                    openSupportFromNotification(detalhes);

                    void dismissSelected();

                  }}

                  className="rounded-md border border-secondary-blue px-4 py-2 text-sm font-medium text-secondary-blue hover:bg-secondary-blue/5"

                >

                  {isSupportIncoming(selected) ? "Ver mensagens" : "Ver conversa"}

                </button>

              ) : null}

              <button

                type="button"
                data-testid={homeTestIds.headerNotificationDetailOk}

                onClick={() => void dismissSelected()}

                className="rounded-md bg-primary-green px-4 py-2 text-sm font-semibold text-white"

              >

                OK

              </button>

            </div>

          </div>

        </div>

      ) : null}

    </>

  );

}


