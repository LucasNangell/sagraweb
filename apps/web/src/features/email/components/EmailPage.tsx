import { cn } from "@sagra/ui";
import { ArrowLeft } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import {
  useEmailConfig,
  useEmailInbox,
  useEmailMutations,
  useEmailPendencias,
} from "@/api/hooks/useEmailQueries";
import { useAuthStore } from "@/features/auth/authStore";
import { canAccessRoute } from "@/components/layout/nav-config";
import type { EmailTab, InboxEmail, PendenciaOs } from "../types";
import { pendenciaKey } from "../utils";
import { EmailConfigPanel } from "./EmailConfigPanel";
import { EmailInboxDetail } from "./EmailInboxDetail";
import { EmailListPanel } from "./EmailListPanel";
import { EmailNav } from "./EmailNav";
import { EmailPendenciaDetail } from "./EmailPendenciaDetail";
import { EmailToast } from "./EmailToast";

export function EmailPage() {
  const user = useAuthStore((s) => s.user);
  const permissions = useAuthStore((s) => s.permissions);
  const ponto = user ? String(user.ponto) : "";
  const canManageExchangeConfig = canAccessRoute(
    permissions,
    "/admin/configuracoes",
  );

  const [activeTab, setActiveTab] = useState<EmailTab>("inbox");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);

  const configQuery = useEmailConfig();
  const refreshIntervalSec =
    configQuery.data?.refresh_interval_sec && configQuery.data.configured
      ? configQuery.data.refresh_interval_sec
      : 5;

  const inboxQuery = useEmailInbox(true, refreshIntervalSec * 1000);
  const pendenciasQuery = useEmailPendencias(activeTab === "pendencias");
  const { andamentoMutation, markReadMutation, sendPtMutation, pendenciaAndamentoMutation, saveEmailMhtMutation } =
    useEmailMutations();

  const inbox = inboxQuery.data ?? [];
  const pendencias = pendenciasQuery.data ?? [];
  const showPendenciasDot = pendencias.length > 0;

  const selectedInbox = useMemo((): InboxEmail | null => {
    if (activeTab !== "inbox" || !selectedKey) return null;
    return inbox.find((e) => e.id === selectedKey) ?? null;
  }, [activeTab, inbox, selectedKey]);

  const selectedPendencia = useMemo((): PendenciaOs | null => {
    if (activeTab !== "pendencias" || !selectedKey) return null;
    return pendencias.find((p) => pendenciaKey(p) === selectedKey) ?? null;
  }, [activeTab, pendencias, selectedKey]);

  const handleTabChange = useCallback((tab: EmailTab) => {
    setActiveTab(tab);
    setSelectedKey(null);
    setSearch("");
  }, []);

  const clearToast = useCallback(() => setToast(null), []);

  const inboxInitialLoading = inboxQuery.isPending && inbox.length === 0;
  const pendenciasInitialLoading =
    pendenciasQuery.isPending && pendencias.length === 0;

  const listLoading =
    activeTab === "inbox" ? inboxInitialLoading : pendenciasInitialLoading;

  const inboxStaleError = inboxQuery.isError && inbox.length > 0;
  const pendenciasStaleError =
    pendenciasQuery.isError && pendencias.length > 0;

  const listStaleError =
    activeTab === "inbox" ? inboxStaleError : pendenciasStaleError;

  const listFatalError =
    activeTab === "inbox"
      ? inboxQuery.isError && inbox.length === 0
      : pendenciasQuery.isError && pendencias.length === 0;

  const listErrorMsg =
    activeTab === "inbox"
      ? inboxQuery.error instanceof Error
        ? inboxQuery.error.message
        : undefined
      : pendenciasQuery.error instanceof Error
        ? pendenciasQuery.error.message
        : undefined;

  const listCount =
    activeTab === "inbox" ? inbox.length : pendencias.length;

  const handleRefreshInbox = () => {
    void inboxQuery.refetch();
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-sm md:flex-row">
        <EmailNav
          activeTab={activeTab}
          onTabChange={handleTabChange}
          showPendenciasDot={showPendenciasDot}
          pendenciasCount={pendencias.length}
          onOpenConfig={
            canManageExchangeConfig ? () => setConfigOpen(true) : undefined
          }
          configActive={configOpen}
          showConfigButton={canManageExchangeConfig}
        />

        <EmailListPanel
          activeTab={activeTab}
          search={search}
          onSearchChange={setSearch}
          selectedKey={selectedKey}
          onSelect={setSelectedKey}
          inbox={inbox}
          pendencias={pendencias}
          itemCount={listCount}
          isLoading={listLoading}
          isFatalError={listFatalError}
          isStaleError={listStaleError}
          errorMessage={listErrorMsg}
          onRefresh={activeTab === "inbox" ? handleRefreshInbox : undefined}
          isRefreshing={
            activeTab === "inbox" &&
            inboxQuery.isFetching &&
            !inboxInitialLoading
          }
          className={cn(selectedKey && "max-md:hidden")}
        />

        <section
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white",
            !selectedKey && "max-md:hidden",
          )}
        >
          {selectedKey ? (
            <div className="flex shrink-0 items-center border-b border-slate-200/80 bg-slate-50 px-3 py-2 md:hidden">
              <button
                type="button"
                onClick={() => setSelectedKey(null)}
                className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-semibold text-secondary-blue hover:bg-white"
              >
                <ArrowLeft className="size-4 shrink-0" aria-hidden />
                Voltar à lista
              </button>
            </div>
          ) : null}

          {activeTab === "inbox" ? (
            <EmailInboxDetail
              email={selectedInbox}
              ponto={ponto}
              onToast={setToast}
              onClearSelection={() => setSelectedKey(null)}
              onSendAndamento={(payload) =>
                andamentoMutation.mutateAsync({ ...payload, ponto })
              }
              onMarkRead={async (emailEntryId) => {
                await markReadMutation.mutateAsync({
                  email_entry_id: emailEntryId,
                  category: "Lido e Desconsiderado",
                });
              }}
              onReply={async ({ os, ano, email_entry_id }) => {
                if (!selectedInbox) return;
                await sendPtMutation.mutateAsync({
                  os,
                  ano,
                  versao: "1",
                  to: [selectedInbox.email],
                  ponto,
                  type: "reply",
                  email_entry_id,
                  register_andamento: true,
                });
              }}
              onSaveEmail={async ({ os, ano, email_entry_id }) => {
                await saveEmailMhtMutation.mutateAsync({
                  os,
                  ano,
                  email_entry_id,
                });
              }}
              sendingAndamento={andamentoMutation.isPending}
              markingRead={markReadMutation.isPending}
              replying={sendPtMutation.isPending}
              savingMht={saveEmailMhtMutation.isPending}
            />
          ) : (
            <EmailPendenciaDetail
              item={selectedPendencia}
              ponto={ponto}
              onToast={setToast}
              onSendEmail={async (payload) =>
                sendPtMutation.mutateAsync({
                  ...payload,
                  ponto,
                  register_andamento: false,
                  email_entry_id: payload.email_entry_id ?? undefined,
                })
              }
              onRegisterAndamento={async (payload) =>
                pendenciaAndamentoMutation.mutateAsync({ ...payload, ponto })
              }
              sending={sendPtMutation.isPending}
              registeringAndamento={pendenciaAndamentoMutation.isPending}
            />
          )}
        </section>
      </div>

      <EmailToast message={toast} onClear={clearToast} />

      {canManageExchangeConfig ? (
        <EmailConfigPanel
          open={configOpen}
          onClose={() => setConfigOpen(false)}
          onSaved={() => {
            void configQuery.refetch();
            void inboxQuery.refetch();
            setToast("Configurações globais do Exchange salvas.");
          }}
        />
      ) : null}
    </div>
  );
}
