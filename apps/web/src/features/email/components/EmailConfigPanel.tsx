import { cn } from "@sagra/ui";
import {
  Check,
  CheckCircle2,
  FolderOpen,
  Loader2,
  Mail,
  Save,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  useEmailConfig,
  useEmailConfigMutations,
} from "@/api/hooks/useEmailQueries";
import type {
  EmailExchangeConfig,
  EmailFolderInfo,
  EmailMailboxInfo,
  EmailMonitoredFolder,
  EmailMonitoredTarget,
} from "../types";
import { emailInputClass, emailLabelClass } from "./email-ui";

interface EmailConfigPanelProps {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

const DEFAULT_EWS_URL = "https://ce.camara.leg.br/EWS/Exchange.asmx";
const EMAIL_TYPES = ["pt", "proof", "apogee", "reply"] as const;
type EmailTypeKey = (typeof EMAIL_TYPES)[number];

function folderKey(mailbox: string, folder: EmailMonitoredFolder): string {
  return `${mailbox}::${folder.id || folder.name}`;
}

export function EmailConfigPanel({
  open,
  onClose,
  onSaved,
}: EmailConfigPanelProps) {
  const configQuery = useEmailConfig();
  const { connectMutation, foldersMutation, saveMutation } =
    useEmailConfigMutations();

  const [ewsUrl, setEwsUrl] = useState(DEFAULT_EWS_URL);
  const [verifySsl, setVerifySsl] = useState(false);
  const [extraMailbox, setExtraMailbox] = useState("");

  const [mailboxes, setMailboxes] = useState<EmailMailboxInfo[]>([]);
  const [selectedMailbox, setSelectedMailbox] = useState<string | null>(null);
  const [routingMailbox, setRoutingMailbox] = useState<string | null>(null);
  const [availableFolders, setAvailableFolders] = useState<EmailFolderInfo[]>(
    [],
  );
  const [sentFolders, setSentFolders] = useState<EmailFolderInfo[]>([]);
  const [routingFolderRoot, setRoutingFolderRoot] = useState<
    "msgfolderroot" | "sentitems"
  >("msgfolderroot");
  const [selectedFolders, setSelectedFolders] = useState<
    Record<string, EmailMonitoredFolder>
  >({});
  const [sendRoutingByType, setSendRoutingByType] = useState<
    Record<EmailTypeKey, string>
  >({
    pt: "",
    proof: "",
    apogee: "",
    reply: "",
  });
  const [sentFolderRoutingByMailboxType, setSentFolderRoutingByMailboxType] =
    useState<
      Record<string, Partial<Record<EmailTypeKey, EmailMonitoredFolder>>>
    >({});
  const [connected, setConnected] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const applyConfig = useCallback((config: EmailExchangeConfig) => {
    setEwsUrl(config.ews_url || DEFAULT_EWS_URL);
    setVerifySsl(Boolean(config.verify_ssl));

    const nextSelected: Record<string, EmailMonitoredFolder> = {};
    let firstMailbox: string | null = null;
    for (const target of config.monitored_targets || []) {
      for (const folder of target.folders || []) {
        nextSelected[folderKey(target.mailbox, folder)] = {
          id: folder.id || "",
          name: folder.name,
          parent: folder.parent || "Inbox",
        };
      }
      if (target.mailbox && !firstMailbox) {
        firstMailbox = target.mailbox;
      }
    }
    setSelectedFolders(nextSelected);
    const routing = config.send_routing?.by_type ?? {};
    setSendRoutingByType({
      pt: routing.pt ?? "",
      proof: routing.proof ?? "",
      apogee: routing.apogee ?? "",
      reply: routing.reply ?? "",
    });
    const byMailbox = config.sent_folder_routing?.by_mailbox ?? {};
    const normalizedByMailbox: Record<
      string,
      Partial<Record<EmailTypeKey, EmailMonitoredFolder>>
    > = {};
    for (const [mailbox, map] of Object.entries(byMailbox)) {
      normalizedByMailbox[mailbox] = {};
      for (const emailType of EMAIL_TYPES) {
        const folder = map[emailType];
        if (!folder?.name) continue;
        normalizedByMailbox[mailbox][emailType] = {
          id: folder.id ?? "",
          name: folder.name,
          parent: folder.parent ?? "sentitems",
        };
      }
    }
    setSentFolderRoutingByMailboxType(normalizedByMailbox);
    if (firstMailbox) {
      setSelectedMailbox(firstMailbox);
      setRoutingMailbox(firstMailbox);
    }
    setConnected(Boolean(config.configured));
  }, []);

  useEffect(() => {
    if (configQuery.data) {
      applyConfig(configQuery.data);
    }
  }, [applyConfig, configQuery.data]);

  const selectedFolderList = useMemo(
    () => Object.values(selectedFolders),
    [selectedFolders],
  );

  const monitoredTargets = useMemo(() => {
    const byMailbox = new Map<string, EmailMonitoredFolder[]>();
    for (const [key, folder] of Object.entries(selectedFolders)) {
      const mailbox = key.split("::")[0] ?? "";
      if (!mailbox) continue;
      const list = byMailbox.get(mailbox) ?? [];
      list.push(folder);
      byMailbox.set(mailbox, list);
    }
    return Array.from(byMailbox.entries()).map(([mailbox, folders]) => ({
      mailbox,
      folders,
    }));
  }, [selectedFolders]);

  const monitoredSummary = useMemo(
    () =>
      monitoredTargets.map((target) => ({
        mailbox: target.mailbox,
        foldersCount: target.folders.length,
      })),
    [monitoredTargets],
  );

  const handleConnect = async () => {
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const extras = extraMailbox.trim() ? [extraMailbox.trim()] : [];
      const result = await connectMutation.mutateAsync({
        ews_url: ewsUrl.trim() || DEFAULT_EWS_URL,
        verify_ssl: verifySsl,
        extra_mailboxes: extras,
      });
      setMailboxes(result.mailboxes);
      setConnected(true);
      const firstAccessible =
        result.mailboxes.find((item) => item.accessible)?.address ??
        result.mailboxes[0]?.address ??
        null;
      setSelectedMailbox(firstAccessible);
      setRoutingMailbox(firstAccessible);
      setStatusMessage("Conexão realizada. Selecione a conta e as pastas.");
    } catch (error) {
      setConnected(false);
      setErrorMessage(
        error instanceof Error ? error.message : "Falha ao conectar ao Exchange.",
      );
    }
  };

  const loadFolders = async (
    mailbox: string,
    parent: "inbox" | "sentitems" | "msgfolderroot",
  ) => {
    setErrorMessage(null);
    if (parent === "inbox") setSelectedMailbox(mailbox);
    else {
      setRoutingMailbox(mailbox);
      if (parent === "msgfolderroot" || parent === "sentitems") {
        setRoutingFolderRoot(parent);
      }
    }
    try {
      const result = await foldersMutation.mutateAsync({
        ews_url: ewsUrl.trim() || DEFAULT_EWS_URL,
        verify_ssl: verifySsl,
        mailbox,
        parent,
      });
      if (parent === "inbox") {
        setAvailableFolders(result.folders);
      } else {
        setSentFolders(result.folders);
      }
    } catch (error) {
      if (parent === "inbox") {
        setAvailableFolders([]);
      } else {
        setSentFolders([]);
      }
      setErrorMessage(
        error instanceof Error ? error.message : "Falha ao listar pastas.",
      );
    }
  };

  const toggleFolder = (mailbox: string, folder: EmailFolderInfo) => {
    const monitored: EmailMonitoredFolder = {
      id: folder.id,
      name: folder.name,
      parent: "Inbox",
    };
    const key = folderKey(mailbox, monitored);
    setSelectedFolders((current) => {
      const next = { ...current };
      if (next[key]) {
        delete next[key];
      } else {
        next[key] = monitored;
      }
      return next;
    });
  };

  const removeFolder = (mailbox: string, folder: EmailMonitoredFolder) => {
    const key = folderKey(mailbox, folder);
    setSelectedFolders((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const removeMailboxMonitoring = (mailbox: string) => {
    setSelectedFolders((current) => {
      const next = { ...current };
      for (const key of Object.keys(next)) {
        if (key.startsWith(`${mailbox}::`)) delete next[key];
      }
      return next;
    });
  };

  const updateSendMailbox = (emailType: EmailTypeKey, mailbox: string) => {
    setSendRoutingByType((current) => ({ ...current, [emailType]: mailbox }));
  };

  const updateSentFolder = (emailType: EmailTypeKey, folder: EmailFolderInfo) => {
    if (!routingMailbox) return;
    setSentFolderRoutingByMailboxType((current) => ({
      ...current,
      [routingMailbox]: {
        ...(current[routingMailbox] ?? {}),
        [emailType]: {
          id: folder.id,
          name: folder.name,
          parent: routingFolderRoot,
        },
      },
    }));
  };

  const sentFoldersById = useMemo(
    () => new Map(sentFolders.map((f) => [f.id, f] as const)),
    [sentFolders],
  );

  const sentFolderPathsById = useMemo(() => {
    const rootLabel = routingFolderRoot === "msgfolderroot" ? "msgfolderroot" : "sentitems";

    const getPath = (folder: EmailFolderInfo) => {
      const parts: string[] = [];
      let current: EmailFolderInfo | undefined = folder;
      let guard = 0;
      while (current && guard < 30) {
        parts.unshift(current.name);
        const parentId = current.parent_id;
        if (!parentId) break;
        current = sentFoldersById.get(parentId);
        guard += 1;
      }
      return parts.length ? `${rootLabel} / ${parts.join(" / ")}` : rootLabel;
    };

    const map: Record<string, string> = {};
    for (const folder of sentFolders) {
      map[folder.id] = getPath(folder);
    }
    return map;
  }, [routingFolderRoot, sentFolders, sentFoldersById]);

  const sentFolderDepthById = useMemo(() => {
    const map: Record<string, number> = {};
    for (const folder of sentFolders) {
      let depth = 0;
      let current: EmailFolderInfo | undefined = folder;
      let guard = 0;
      while (current && guard < 30) {
        depth += 1;
        const parentId = current.parent_id;
        if (!parentId) break;
        current = sentFoldersById.get(parentId);
        guard += 1;
      }
      map[folder.id] = depth;
    }
    return map;
  }, [sentFolders, sentFoldersById]);

  const handleSave = async () => {
    setErrorMessage(null);
    setStatusMessage(null);
    if (monitoredTargets.length === 0 || selectedFolderList.length === 0) {
      setErrorMessage("Selecione ao menos uma pasta para monitorar.");
      return;
    }
    try {
      await saveMutation.mutateAsync({
        monitored_targets: monitoredTargets,
        send_routing: { by_type: sendRoutingByType },
        sent_folder_routing: { by_mailbox: sentFolderRoutingByMailboxType },
        config_version: 2,
      });
      setStatusMessage("Configurações salvas com sucesso.");
      onSaved?.();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Erro ao salvar configurações.",
      );
    }
  };

  if (!open) return null;

  const isBusy =
    connectMutation.isPending ||
    foldersMutation.isPending ||
    saveMutation.isPending;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/35">
      <button
        type="button"
        className="min-w-0 flex-1 cursor-default"
        aria-label="Fechar configurações"
        onClick={onClose}
      />

      <aside className="flex h-full w-full max-w-xl flex-col border-l border-slate-200 bg-white shadow-2xl">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-secondary-blue/10 text-secondary-blue">
              <Settings2 className="size-5" aria-hidden />
            </div>
            <div>
              <h2 className="text-lg font-bold text-secondary-blue">
                Configurações do Exchange
              </h2>
              <p className="text-xs text-slate-500">
                Defina a configuração global de monitoramento e envio para todos os usuários.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
            aria-label="Fechar"
          >
            <X className="size-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <section className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/70 p-4">
            <h3 className="text-sm font-semibold text-secondary-blue">
              1. Conexão
            </h3>
            <div>
              <label className={emailLabelClass} htmlFor="extra-mailbox">
                Caixa adicional (opcional)
              </label>
              <input
                id="extra-mailbox"
                type="email"
                value={extraMailbox}
                onChange={(e) => setExtraMailbox(e.target.value)}
                placeholder="shared@camara.leg.br"
                className={emailInputClass}
              />
            </div>
            <button
              type="button"
              onClick={() => void handleConnect()}
              disabled={isBusy}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-secondary-blue px-4 text-sm font-semibold text-white hover:bg-secondary-blue/90 disabled:opacity-60"
            >
              {connectMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CheckCircle2 className="size-4" />
              )}
              Conectar e listar contas
            </button>
            {connected ? (
              <p className="flex items-center gap-1.5 text-xs text-emerald-700">
                <CheckCircle2 className="size-3.5" />
                Conexão do servidor validada
              </p>
            ) : null}
          </section>

          {mailboxes.length > 0 ? (
            <section className="space-y-3 rounded-lg border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-secondary-blue">
                2. Contas disponíveis
              </h3>
              <div className="space-y-2">
                {mailboxes.map((mailbox) => (
                  <button
                    key={mailbox.address}
                    type="button"
                    disabled={!mailbox.accessible || isBusy}
                    onClick={() => void loadFolders(mailbox.address, "inbox")}
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition",
                      selectedMailbox === mailbox.address
                        ? "border-secondary-blue bg-secondary-blue/5 text-secondary-blue"
                        : "border-slate-200 hover:border-secondary-blue/40",
                      !mailbox.accessible && "cursor-not-allowed opacity-50",
                    )}
                  >
                    <span className="truncate font-medium">{mailbox.address}</span>
                    <span className="shrink-0 text-[11px] uppercase tracking-wide text-slate-500">
                      {mailbox.is_primary
                        ? "Principal"
                        : mailbox.accessible
                          ? "Acessível"
                          : "Sem acesso"}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {monitoredSummary.length > 0 ? (
            <section className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/70 p-4">
              <h3 className="text-sm font-semibold text-emerald-800">
                3. Contas monitoradas
              </h3>
              <div className="space-y-2">
                {monitoredSummary.map((target) => (
                  <div
                    key={target.mailbox}
                    className="flex items-center justify-between rounded-md border border-emerald-200 bg-white px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-emerald-900">
                        {target.mailbox}
                      </p>
                      <p className="text-xs text-emerald-700">
                        {target.foldersCount} pasta(s) monitorada(s)
                      </p>
                    </div>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                      onClick={() => removeMailboxMonitoring(target.mailbox)}
                    >
                      <Trash2 className="size-3.5" />
                      Remover conta
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {selectedMailbox && availableFolders.length > 0 ? (
            <section className="space-y-3 rounded-lg border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-secondary-blue">
                4. Pastas monitoradas de {selectedMailbox}
              </h3>
              <div className="max-h-56 space-y-1 overflow-y-auto">
                {availableFolders.map((folder) => {
                  const monitored: EmailMonitoredFolder = {
                    id: folder.id,
                    name: folder.name,
                    parent: "Inbox",
                  };
                  const checked = Boolean(
                    selectedFolders[folderKey(selectedMailbox, monitored)],
                  );
                  return (
                    <label
                      key={folder.id}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleFolder(selectedMailbox, folder)}
                        className="accent-secondary-blue"
                      />
                      <FolderOpen className="size-4 shrink-0 text-slate-400" />
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {folder.name}
                      </span>
                      {folder.unread_count != null ? (
                        <span className="text-xs text-slate-500">
                          {folder.unread_count} não lidos
                        </span>
                      ) : null}
                    </label>
                  );
                })}
              </div>
            </section>
          ) : null}

          {selectedFolderList.length > 0 ? (
            <section className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-4">
              <h3 className="text-sm font-semibold text-emerald-800">
                Pastas selecionadas ({selectedFolderList.length})
              </h3>
              <ul className="mt-2 space-y-1 text-xs text-emerald-900">
                {Object.entries(selectedFolders).map(([key, folder]) => (
                  <li key={key} className="flex items-center justify-between gap-2">
                    <span className="truncate">
                      {key.split("::")[0]} / {folder.name}
                    </span>
                    <button
                      type="button"
                      className="rounded p-1 text-red-600 hover:bg-red-50"
                      onClick={() =>
                        removeFolder(key.split("::")[0], folder)
                      }
                    >
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {mailboxes.length > 0 ? (
            <section className="space-y-3 rounded-lg border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-secondary-blue">
                5. Roteamento de enviados
              </h3>
              <div className="rounded-md border border-slate-200 p-3">
                <label className={emailLabelClass} htmlFor="routing-mailbox">
                  Conta para configurar pasta de enviados
                </label>
                <div className="mt-1 flex gap-2">
                  <select
                    id="routing-mailbox"
                    className={emailInputClass}
                    value={routingMailbox ?? ""}
                    onChange={(e) => setRoutingMailbox(e.target.value || null)}
                  >
                    <option value="">Selecione uma conta</option>
                    {mailboxes
                      .filter((mailbox) => mailbox.accessible)
                      .map((mailbox) => (
                        <option key={mailbox.address} value={mailbox.address}>
                          {mailbox.address}
                        </option>
                      ))}
                  </select>
                  <button
                    type="button"
                    onClick={() =>
                      routingMailbox
                        ? void loadFolders(routingMailbox, "msgfolderroot")
                        : null
                    }
                    disabled={!routingMailbox || isBusy}
                    className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    {foldersMutation.isPending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <FolderOpen className="size-4" />
                    )}
                    Todas as pastas
                  </button>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  Carrega a estrutura completa da caixa selecionada para escolher
                  qualquer pasta ou subpasta de salvamento.
                </p>
              </div>

              <div className="space-y-2">
                {EMAIL_TYPES.map((emailType) => {
                  const mailbox = sendRoutingByType[emailType];
                  const target =
                    mailbox && sentFolderRoutingByMailboxType[mailbox]
                      ? sentFolderRoutingByMailboxType[mailbox][emailType]
                      : undefined;
                  return (
                    <div
                      key={emailType}
                      className="rounded-md border border-slate-200 p-3"
                    >
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Tipo: {emailType}
                      </p>
                      <div className="mt-2 grid gap-2 md:grid-cols-2">
                        <select
                          className={emailInputClass}
                          value={mailbox}
                          onChange={(e) =>
                            updateSendMailbox(emailType, e.target.value)
                          }
                        >
                          <option value="">Usar fallback legado/global</option>
                          {mailboxes
                            .filter((item) => item.accessible)
                            .map((item) => (
                              <option key={item.address} value={item.address}>
                                {item.address}
                              </option>
                            ))}
                        </select>
                        <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs text-slate-700">
                          <Mail className="mr-2 size-3.5 text-slate-400" />
                          {target?.name
                            ? `${target.name} (${mailbox})`
                            : "Pasta padrão de enviados (fallback)"}
                        </div>
                      </div>
                      {mailbox && sentFolders.length > 0 ? (
                        <div className="mt-2 max-h-28 space-y-1 overflow-y-auto rounded-md border border-slate-200 bg-white p-2">
                          {sentFolders.map((folder) => {
                            const checked = target?.id === folder.id;
                            return (
                              <button
                                type="button"
                                key={`${emailType}-${folder.id}`}
                                className={cn(
                                  "flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs hover:bg-slate-50",
                                  checked && "bg-secondary-blue/5 text-secondary-blue",
                                )}
                                onClick={() => updateSentFolder(emailType, folder)}
                              >
                                <div className="min-w-0">
                                  <span className="block truncate font-medium">
                                    <span
                                      style={{
                                        paddingLeft:
                                          (sentFolderDepthById[folder.id] ?? 1) * 10,
                                      }}
                                    >
                                      {folder.name}
                                    </span>
                                  </span>
                                  <span className="block truncate text-[10px] text-slate-500">
                                    {sentFolderPathsById[folder.id] ?? folder.name}
                                  </span>
                                </div>
                                {checked ? <Check className="size-3.5" /> : null}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          {errorMessage ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {errorMessage}
            </p>
          ) : null}
          {statusMessage ? (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {statusMessage}
            </p>
          ) : null}
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={isBusy}
            className="inline-flex items-center gap-2 rounded-lg bg-primary-green px-4 py-2 text-sm font-semibold text-white hover:bg-primary-green/90 disabled:opacity-60"
          >
            {saveMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            Salvar configurações
          </button>
        </footer>
      </aside>
    </div>
  );
}
