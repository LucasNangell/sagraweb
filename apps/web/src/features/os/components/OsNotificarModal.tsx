import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, X } from "lucide-react";
import { useEffect, useState } from "react";

import { useSetoresLookup, useSituacoesLookup } from "@/api/hooks/useAuxLookups";
import {
  deleteOsNotificacaoWatch,
  fetchOsNotificacaoWatch,
  saveOsNotificacaoWatch,
  testPushNotification,
} from "@/api/osNotificacao";
import { queryKeys } from "@/api/query-keys";
import { useWebPush } from "@/hooks/useWebPush";
import { getNotificationSupport } from "@/lib/nativeNotification";
import { homeTestIds } from "@/lib/testId";
import type { OsSearchRow } from "../types";

interface OsNotificarModalProps {
  row: OsSearchRow | null;
  open: boolean;
  onClose: () => void;
}

export function OsNotificarModal({ row, open, onClose }: OsNotificarModalProps) {
  const queryClient = useQueryClient();
  const { requestBrowserPush } = useWebPush();

  const [notifyAndamentos, setNotifyAndamentos] = useState(false);
  const [notifyAllAndamentos, setNotifyAllAndamentos] = useState(true);
  const [andamentoSituacao, setAndamentoSituacao] = useState("");
  const [andamentoSetor, setAndamentoSetor] = useState("");
  const [notifyOsChanges, setNotifyOsChanges] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [testHint, setTestHint] = useState<string | null>(null);
  const [notificationSupport, setNotificationSupport] = useState(
    getNotificationSupport,
  );

  const ano = row?.ano ?? null;
  const id = row?.nr_os ?? null;

  const situacoesQuery = useSituacoesLookup();
  const setoresQuery = useSetoresLookup();

  const watchQuery = useQuery({
    queryKey:
      open && ano != null && id != null
        ? queryKeys.os.notificacaoWatch(ano, id)
        : ["os", "notificacaoWatch", "idle"],
    queryFn: () => fetchOsNotificacaoWatch(ano!, id!),
    enabled: open && ano != null && id != null,
  });

  useEffect(() => {
    if (!open || !watchQuery.data) {
      if (!open) {
        setNotifyAndamentos(false);
        setNotifyAllAndamentos(true);
        setAndamentoSituacao("");
        setAndamentoSetor("");
        setNotifyOsChanges(false);
        setTestHint(null);
      }
      return;
    }
    const w = watchQuery.data;
    setNotifyAndamentos(w.notify_andamentos);
    setNotifyAllAndamentos(w.notify_all_andamentos);
    setAndamentoSituacao(w.andamento_situacao ?? "");
    setAndamentoSetor(w.andamento_setor ?? "");
    setNotifyOsChanges(w.notify_os_changes);
  }, [open, watchQuery.data]);

  useEffect(() => {
    if (open) {
      setNotificationSupport(getNotificationSupport());
    }
  }, [open]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!notifyAndamentos && !notifyOsChanges) {
        await deleteOsNotificacaoWatch(ano!, id!);
        return null;
      }
      const saved = await saveOsNotificacaoWatch(ano!, id!, {
        notify_andamentos: notifyAndamentos,
        notify_all_andamentos: notifyAllAndamentos,
        andamento_situacao: notifyAllAndamentos ? null : andamentoSituacao.trim() || null,
        andamento_setor: notifyAllAndamentos ? null : andamentoSetor.trim() || null,
        notify_os_changes: notifyOsChanges,
      });
      const pushResult = await requestBrowserPush();
      setNotificationSupport(getNotificationSupport());
      if (!pushResult.permission) {
        throw new Error("push_permission_denied");
      }
      if (pushResult.push !== "ok") {
        throw new Error("push_background_unavailable");
      }
      return saved;
    },
    onSuccess: () => {
      if (ano != null && id != null) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.os.notificacaoWatch(ano, id),
        });
      }
      onClose();
    },
  });

  if (!open || !row) {
    return null;
  }

  const handleSave = async () => {
    if (!notifyAndamentos && !notifyOsChanges) {
      if (!window.confirm("Desativar todas as notificações desta OS?")) {
        return;
      }
    } else if (notifyAndamentos && !notifyAllAndamentos) {
      if (!andamentoSituacao.trim() || !andamentoSetor.trim()) {
        window.alert("Informe o andamento e o setor, ou marque todos os andamentos.");
        return;
      }
    }

    try {
      await saveMutation.mutateAsync();
    } catch (e) {
      if (e instanceof Error && e.message === "push_permission_denied") {
        if (ano != null && id != null) {
          void queryClient.invalidateQueries({
            queryKey: queryKeys.os.notificacaoWatch(ano, id),
          });
        }
        window.alert(
          "Preferências salvas, mas o Windows não vai exibir o aviso. Permita notificações do navegador (Edge/Chrome) e tente de novo.",
        );
        onClose();
        return;
      }
      if (e instanceof Error && e.message === "push_background_unavailable") {
        if (ano != null && id != null) {
          void queryClient.invalidateQueries({
            queryKey: queryKeys.os.notificacaoWatch(ano, id),
          });
        }
        window.alert(
          "Preferências salvas. A notificação do Windows funciona com o SAGRA aberto neste navegador. Com o navegador fechado não está disponível nesta rede.",
        );
        onClose();
        return;
      }
      window.alert(
        `Erro ao salvar: ${e instanceof Error ? e.message : "falha"}`,
      );
    }
  };

  const handleTest = async () => {
    if (testBusy) {
      return;
    }
    setTestBusy(true);
    setTestHint(null);
    try {
      const pushResult = await requestBrowserPush();
      setNotificationSupport(getNotificationSupport());
      if (!pushResult.permission) {
        return;
      }
      const result = await testPushNotification();
      const parts = [
        "Pedido de teste enviado.",
        "Se o aviso do Windows não aparecer, verifique Configurações → Sistema → Notificações e o Assistente de Foco.",
      ];
      if (result.web_push_subs === 0 || result.web_push_sent === 0) {
        parts.push(
          "Push com navegador fechado não está disponível neste dispositivo/rede.",
        );
      }
      setTestHint(parts.join(" "));
    } catch (e) {
      window.alert(
        `Não foi possível testar: ${e instanceof Error ? e.message : "falha"}`,
      );
    } finally {
      setTestBusy(false);
    }
  };

  const handleRemove = async () => {
    if (!window.confirm("Remover inscrição de notificações desta OS?")) {
      return;
    }
    try {
      await deleteOsNotificacaoWatch(ano!, id!);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.os.notificacaoWatch(ano!, id!),
      });
      onClose();
    } catch (e) {
      window.alert(`Erro: ${e instanceof Error ? e.message : "falha"}`);
    }
  };

  const hasActiveWatch = Boolean(watchQuery.data?.ativo);

  return (
    <div
      className="fixed inset-0 z-[10002] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      data-testid={homeTestIds.osNotificarRoot}
    >
      <div className="relative w-full max-w-lg rounded-lg border-t-4 border-[#24344D] bg-white p-6 shadow-xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 text-neutral-500 hover:text-neutral-800"
          aria-label="Fechar"
          data-testid={homeTestIds.osNotificarClose}
        >
          <X className="size-5" />
        </button>
        <div className="flex items-center gap-2">
          <Bell className="size-5 text-primary-green" aria-hidden />
          <h3 className="text-lg font-semibold text-primary-green">Notificar</h3>
        </div>
        <p className="mt-1 text-sm text-neutral-600">
          OS {row.nr_os}/{row.ano} — escolha os eventos. Os avisos aparecem como
          notificação do Windows (canto inferior direito) enquanto o SAGRA estiver
          aberto em alguma aba.
        </p>

        <div className="mt-4 space-y-3 rounded border border-sagra-border bg-slate-50 p-3 text-sm">
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={notifyAndamentos}
              onChange={(e) => setNotifyAndamentos(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="font-semibold">Andamentos</span>
              <span className="mt-0.5 block text-xs text-neutral-600">
                Avisar quando houver lançamento de andamento nesta OS.
              </span>
            </span>
          </label>

          {notifyAndamentos ? (
            <div className="ml-6 space-y-2 border-l-2 border-sagra-border pl-3">
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="radio"
                  name="andamento-scope"
                  checked={notifyAllAndamentos}
                  onChange={() => setNotifyAllAndamentos(true)}
                />
                Todos os andamentos
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="radio"
                  name="andamento-scope"
                  checked={!notifyAllAndamentos}
                  onChange={() => setNotifyAllAndamentos(false)}
                />
                Andamento e setor específicos
              </label>
              {!notifyAllAndamentos ? (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className="text-xs">
                    <span className="font-semibold">Andamento</span>
                    <select
                      value={andamentoSituacao}
                      onChange={(e) => setAndamentoSituacao(e.target.value)}
                      className="mt-0.5 h-8 w-full rounded border border-sagra-border px-1 text-xs"
                    >
                      <option value="">Selecione...</option>
                      {(situacoesQuery.data ?? []).map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs">
                    <span className="font-semibold">Setor</span>
                    <select
                      value={andamentoSetor}
                      onChange={(e) => setAndamentoSetor(e.target.value)}
                      className="mt-0.5 h-8 w-full rounded border border-sagra-border px-1 text-xs"
                    >
                      <option value="">Selecione...</option>
                      {(setoresQuery.data ?? []).map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ) : null}
            </div>
          ) : null}

          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={notifyOsChanges}
              onChange={(e) => setNotifyOsChanges(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="font-semibold">Alterações na OS</span>
              <span className="mt-0.5 block text-xs text-neutral-600">
                Avisar quando as informações da OS forem alteradas (dados, prazos,
                etc.). Só dispara enquanto o último andamento for seu, iniciado
                após Recebido ou Em Execução; zera se outro ponto lançar andamento.
              </span>
              {notifyOsChanges && watchQuery.data ? (
                <span
                  className={`mt-1 block text-xs font-medium ${
                    watchQuery.data.os_change_control_active
                      ? "text-green-700"
                      : "text-amber-700"
                  }`}
                >
                  {watchQuery.data.os_change_control_active
                    ? "Controle ativo: você é o responsável pelo último andamento."
                    : "Controle inativo: receba ou inicie a execução da OS, ou aguarde se outro ponto lançou andamento."}
                </span>
              ) : null}
            </span>
          </label>
        </div>

        <div
          className="mt-3 rounded border border-sagra-border bg-white px-3 py-2 text-xs text-neutral-600"
          data-testid={homeTestIds.osNotificarStatus}
        >
          <p>
            Permissão do navegador:{" "}
            <span className="font-semibold">
              {notificationSupport === "granted"
                ? "concedida"
                : notificationSupport === "denied"
                  ? "negada"
                  : notificationSupport === "insecure-context"
                    ? "indisponível (HTTP sem localhost)"
                    : notificationSupport === "default"
                      ? "ainda não pedida"
                      : "navegador sem suporte"}
            </span>
          </p>
          {notificationSupport === "insecure-context" ? (
            <p className="mt-1 text-amber-700">
              Use https://cgrafsysvm/sagra/ ou http://localhost:5173 para ativar o
              aviso do Windows.
            </p>
          ) : null}
          {testHint ? <p className="mt-1">{testHint}</p> : null}
        </div>

        <p className="mt-3 text-xs text-neutral-500">
          Ao salvar, o Windows pode pedir permissão (Edge/Chrome). Com o SAGRA
          minimizado o aviso continua; com o navegador totalmente fechado depende da
          rede (FCM/WNS).
        </p>

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {hasActiveWatch ? (
            <button
              type="button"
              onClick={() => void handleRemove()}
              className="mr-auto rounded border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50"
            >
              Remover inscrição
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void handleTest()}
            disabled={testBusy || saveMutation.isPending}
            className="rounded border border-sagra-border px-3 py-2 text-sm disabled:opacity-60"
            data-testid={homeTestIds.osNotificarTest}
          >
            {testBusy ? "Testando…" : "Testar notificação"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-sagra-border px-4 py-2 text-sm"
            data-testid={homeTestIds.osNotificarCancel}
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={saveMutation.isPending}
            onClick={() => void handleSave()}
            className="rounded bg-secondary-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            data-testid={homeTestIds.osNotificarSend}
          >
            {saveMutation.isPending ? "Salvando…" : "Ativar notificações"}
          </button>
        </div>
      </div>
    </div>
  );
}
