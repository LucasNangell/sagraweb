import { apiFetch } from "@/api/client";

export interface OsNotificacaoWatch {
  notify_andamentos: boolean;
  notify_all_andamentos: boolean;
  andamento_situacao: string | null;
  andamento_setor: string | null;
  notify_os_changes: boolean;
  ativo: boolean;
  os_change_control_active?: boolean;
  data_criacao?: string;
  data_atualizacao?: string;
}

export interface OsNotificacaoWatchPayload {
  notify_andamentos: boolean;
  notify_all_andamentos: boolean;
  andamento_situacao?: string | null;
  andamento_setor?: string | null;
  notify_os_changes: boolean;
}

export async function fetchOsNotificacaoWatch(
  ano: number,
  id: number,
): Promise<OsNotificacaoWatch | null> {
  const res = await apiFetch<{ watch: OsNotificacaoWatch | null }>(
    `/os/${ano}/${id}/notificacao-watch`,
  );
  return res.watch;
}

export async function saveOsNotificacaoWatch(
  ano: number,
  id: number,
  payload: OsNotificacaoWatchPayload,
): Promise<OsNotificacaoWatch | null> {
  const res = await apiFetch<{ watch: OsNotificacaoWatch | null; deleted?: boolean }>(
    `/os/${ano}/${id}/notificacao-watch`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  return res.watch;
}

export async function deleteOsNotificacaoWatch(
  ano: number,
  id: number,
): Promise<void> {
  await apiFetch(`/os/${ano}/${id}/notificacao-watch/delete`, { method: "POST" });
}

export async function fetchVapidPublicKey(): Promise<string> {
  const res = await apiFetch<{ public_key: string }>("/push/vapid-public-key");
  return res.public_key;
}

export async function registerPushSubscription(input: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  user_agent?: string;
}): Promise<void> {
  await apiFetch("/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function unregisterPushSubscription(endpoint: string): Promise<void> {
  await apiFetch("/push/subscribe/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  });
}
