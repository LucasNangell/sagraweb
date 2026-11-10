import { cn } from "@sagra/ui";
import { Copy, Loader2, PlusCircle, Save, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { useAdminIpsMutations } from "@/api/hooks/useAdminIpsQueries";
import { buildDefaultNewIpPayload } from "../terminalAccess";
import type {
  AccessRequestRecord,
  IpPermissionPayload,
  IpPermissionRecord,
} from "@/features/acesso/types";

import { buildDefaultIpPermissionValues, IP_PERMISSION_KEYS } from "../permissionCatalog";
import {
  buildTerminalUpdatePayload,
  draftFromRecord,
  findTerminalByIp,
  isTerminalActive,
  isValidIpPattern,
  SEM_GRUPO,
  terminalPermissionValues,
  type TerminalDraft,
} from "../terminalAccess";
import { useConfirm } from "./ConfirmDialog";
import { Drawer, DrawerSection } from "./Drawer";
import { useFeedback } from "./Feedback";
import { PermissionMatrix } from "./PermissionMatrix";

type TerminalDrawerProps =
  | {
      mode: "edit";
      record: IpPermissionRecord;
      allTerminals: ReadonlyArray<IpPermissionRecord>;
      groups: ReadonlyArray<string>;
      onClose: () => void;
    }
  | {
      mode: "create";
      /** Solicitação de acesso sendo aprovada (preenche IP/descrição/grupo). */
      request?: AccessRequestRecord | null;
      allTerminals: ReadonlyArray<IpPermissionRecord>;
      groups: ReadonlyArray<string>;
      onClose: () => void;
      onCreated?: () => void;
    };

export function TerminalDrawer(props: TerminalDrawerProps) {
  const { allTerminals, groups, onClose } = props;
  const feedback = useFeedback();
  const confirm = useConfirm();
  const { addIpMutation, updateIpMutation, deleteIpMutation, deleteRequestMutation } =
    useAdminIpsMutations();

  const editing = props.mode === "edit" ? props.record : null;
  const request = props.mode === "create" ? (props.request ?? null) : null;

  const initial = useMemo<TerminalDraft>(() => {
    if (editing) return draftFromRecord(editing);
    return {
      ip: request?.ip ?? "",
      descricao: request?.nome ?? "",
      grupo: request?.secao ?? "",
      values: buildDefaultIpPermissionValues(),
    };
    // Rascunho inicial fixo por abertura do drawer (remontado por chave).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [draft, setDraft] = useState<TerminalDraft>(initial);
  const [copyFromId, setCopyFromId] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const trimmedIp = draft.ip.trim();
  const duplicate = trimmedIp ? findTerminalByIp(allTerminals, trimmedIp, editing?.id) : undefined;
  const ipInvalid = trimmedIp.length > 0 && !isValidIpPattern(trimmedIp);

  const copyCandidates = useMemo(
    () => allTerminals.filter((t) => t.id !== editing?.id),
    [allTerminals, editing?.id],
  );

  const handleClose = async () => {
    if (dirty) {
      const ok = await confirm({
        title: "Descartar alterações?",
        message: "Há alterações não salvas neste terminal.",
        confirmLabel: "Descartar",
        danger: true,
      });
      if (!ok) return;
    }
    onClose();
  };

  const validate = (): boolean => {
    if (!trimmedIp) {
      feedback.error("Informe o endereço IP do terminal.");
      return false;
    }
    if (ipInvalid) {
      feedback.error("IP inválido: use apenas números, pontos e % como curinga (ex.: 10.120.1.%).");
      return false;
    }
    if (duplicate) {
      feedback.error(
        `O IP ${duplicate.ip} já está cadastrado${duplicate.descricao ? ` (${duplicate.descricao})` : ""}. Edite o terminal existente.`,
      );
      return false;
    }
    return true;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      if (editing) {
        await updateIpMutation.mutateAsync(buildTerminalUpdatePayload(editing.id, draft));
        feedback.success("Terminal atualizado. Pode levar até 30s para valer nos computadores.");
        onClose();
        return;
      }
      const permissionValues = buildTerminalUpdatePayload(0, draft);
      const addPayload: IpPermissionPayload = buildDefaultNewIpPayload(
        trimmedIp,
        draft.descricao.trim(),
        draft.grupo.trim() || SEM_GRUPO,
      );
      for (const key of IP_PERMISSION_KEYS) {
        addPayload[key] = Boolean(permissionValues[key]);
      }
      await addIpMutation.mutateAsync({
        payload: addPayload,
        options: request ? { ponto: request.ponto, nome_usuario: request.nome } : undefined,
      });
      if (request) {
        try {
          await deleteRequestMutation.mutateAsync(request.id);
        } catch (err) {
          feedback.error(
            err instanceof Error
              ? `Terminal salvo, mas falhou ao remover a solicitação: ${err.message}`
              : "Terminal salvo, mas falhou ao remover a solicitação.",
          );
          if (props.mode === "create") props.onCreated?.();
          onClose();
          return;
        }
      }
      feedback.success(request ? "Solicitação aprovada e terminal cadastrado." : "Terminal cadastrado.");
      if (props.mode === "create") props.onCreated?.();
      onClose();
    } catch (err) {
      feedback.error(err instanceof Error ? err.message : "Erro ao salvar o terminal.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editing) return;
    const ok = await confirm({
      title: `Excluir o terminal ${editing.ip}?`,
      message:
        "Computadores com este IP perdem o acesso na rede local (a menos que outro padrão cubra o IP). Esta ação não pode ser desfeita.",
      confirmLabel: "Excluir",
      danger: true,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await deleteIpMutation.mutateAsync(editing.id);
      feedback.success("Terminal excluído.");
      onClose();
    } catch (err) {
      feedback.error(err instanceof Error ? err.message : "Erro ao excluir.");
    } finally {
      setDeleting(false);
    }
  };

  const copyFromTerminal = () => {
    const source = copyCandidates.find((t) => String(t.id) === copyFromId);
    if (!source) return;
    setDraft({ ...draft, values: terminalPermissionValues(source) });
    feedback.success(`Permissões de ${source.ip} copiadas. Revise e salve.`);
  };

  const inputClass =
    "w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-primary-green focus:ring-1 focus:ring-primary-green";

  const title = editing
    ? editing.ip
    : request
      ? `Aprovar solicitação — ${request.nome}`
      : "Novo terminal";

  return (
    <Drawer
      open
      onClose={() => void handleClose()}
      title={title}
      subtitle={
        editing ? (
          <span>
            {editing.descricao || "Sem descrição"} ·{" "}
            {isTerminalActive(editing) ? "Ativo" : "Inativo"}
          </span>
        ) : request ? (
          <span>
            Ponto {request.ponto} · {request.secao} · IP {request.ip}
          </span>
        ) : (
          <span>Comece pelas permissões padrão e ajuste antes de salvar.</span>
        )
      }
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || (editing ? !dirty : false)}
            className="sagra-btn sagra-btn--primary sagra-btn--md"
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : editing ? (
              <Save className="size-4" aria-hidden />
            ) : (
              <PlusCircle className="size-4" aria-hidden />
            )}
            {editing ? "Salvar terminal" : request ? "Aprovar e cadastrar" : "Cadastrar terminal"}
          </button>
          {editing ? (
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={deleting}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-red-700 hover:underline disabled:opacity-50"
            >
              {deleting ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Trash2 className="size-4" aria-hidden />
              )}
              Excluir terminal
            </button>
          ) : null}
        </div>
      }
    >
      <DrawerSection title="Dados do terminal" defaultOpen>
        <div className="space-y-3">
          <div>
            <label htmlFor="acesso-terminal-ip" className="mb-1 block text-xs font-medium text-slate-600">
              Endereço IP (use % como curinga)
            </label>
            <input
              id="acesso-terminal-ip"
              type="text"
              value={draft.ip}
              onChange={(e) => setDraft({ ...draft, ip: e.target.value })}
              placeholder="Ex.: 192.168.0.10 ou 10.120.1.%"
              aria-invalid={Boolean(duplicate || ipInvalid)}
              className={cn(inputClass, "font-mono", (duplicate || ipInvalid) && "border-red-400")}
            />
            {duplicate ? (
              <p className="mt-1 text-xs font-medium text-red-700" role="alert">
                Já cadastrado{duplicate.descricao ? ` como “${duplicate.descricao}”` : ""}. Salvar
                aqui sobrescreveria aquele terminal — edite-o em vez disso.
              </p>
            ) : ipInvalid ? (
              <p className="mt-1 text-xs font-medium text-red-700" role="alert">
                Use apenas números, pontos e % (curinga).
              </p>
            ) : (
              <p className="mt-1 text-xs text-slate-500">
                IP exato tem prioridade sobre padrões com %; entre padrões vale o mais específico.
              </p>
            )}
          </div>
          <div>
            <label htmlFor="acesso-terminal-desc" className="mb-1 block text-xs font-medium text-slate-600">
              Descrição
            </label>
            <input
              id="acesso-terminal-desc"
              type="text"
              value={draft.descricao}
              onChange={(e) => setDraft({ ...draft, descricao: e.target.value })}
              placeholder="Ex.: Computador da Recepção"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="acesso-terminal-grupo" className="mb-1 block text-xs font-medium text-slate-600">
              Grupo/Sala
            </label>
            <input
              id="acesso-terminal-grupo"
              type="text"
              value={draft.grupo}
              onChange={(e) => setDraft({ ...draft, grupo: e.target.value })}
              placeholder={SEM_GRUPO}
              list="acesso-terminal-grupos"
              className={inputClass}
            />
            <datalist id="acesso-terminal-grupos">
              {groups.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
          </div>
        </div>
      </DrawerSection>

      <DrawerSection
        title="Permissões"
        defaultOpen
        description="Valem na rede local para quem entrar por este IP — exceto usuários com permissões próprias, que substituem estas."
      >
        <div className="mb-3 text-xs font-medium text-slate-600">
          Copiar permissões de outro terminal
          <div className="mt-1 flex gap-1">
            <select
              value={copyFromId}
              onChange={(e) => setCopyFromId(e.target.value)}
              className={cn(inputClass, "min-w-0 py-1.5")}
              aria-label="Terminal de origem"
            >
              <option value="">— escolher —</option>
              {copyCandidates.map((t) => (
                <option key={t.id} value={String(t.id)}>
                  {t.ip}
                  {t.descricao ? ` — ${t.descricao}` : ""}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={copyFromTerminal}
              disabled={!copyFromId}
              className="sagra-btn sagra-btn--outline sagra-btn--sm shrink-0"
              title="Copiar (não salva automaticamente)"
            >
              <Copy className="size-4" aria-hidden />
              Copiar
            </button>
          </div>
        </div>
        <PermissionMatrix
          target="ip"
          values={draft.values}
          onChange={(values) => setDraft({ ...draft, values })}
          disabled={saving}
        />
      </DrawerSection>
    </Drawer>
  );
}
