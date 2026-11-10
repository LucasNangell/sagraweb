import { cn } from "@sagra/ui";
import { Copy, KeyRound, Loader2, Mail, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  deleteAuthUser,
  fetchUserIps,
  fetchUserPermissions,
  generatePasswordLink,
  type PasswordLinkResponse,
  resendActivation,
  updateUserIps,
  updateUserPermissions,
  updateUserProfile,
} from "@/api/adminUsers";
import { useAdminIpList } from "@/api/hooks/useAdminIpsQueries";
import { useSetoresLookup } from "@/api/hooks/useAuxLookups";
import { readPermissionValue } from "@/features/admin-ips/constants";
import { useAuthStore } from "@/features/auth/authStore";
import { hasPermission } from "@/features/auth/permissions";
import type { PermissionKey } from "@/features/auth/types";
import {
  deleteUserFace,
  enrollUserFace,
  fetchUserFaceStatus,
} from "@/features/dashboard-tablet/api";
import type { UsuarioRecord } from "@/features/usuarios/types";
import { formatUltimoAcesso } from "@/features/usuarios/utils";

import { IP_PERMISSION_KEYS } from "../permissionCatalog";
import {
  buildUserPermissionsPayload,
  hasInternetAccount,
  isAccountActive,
  isFornecedor,
  isUserPermissionsCustomized,
  parseIpsText,
  permissionsStateFromResponse,
  resolvePainelSetoresSelection,
} from "../userAccess";
import { useConfirm } from "./ConfirmDialog";
import { CopyableLink } from "./CopyableLink";
import { Drawer, DrawerSection } from "./Drawer";
import { useFeedback } from "./Feedback";
import { PermissionMatrix, type PermissionValues } from "./PermissionMatrix";

const PAINEL_KEYS: PermissionKey[] = [
  "sb_dashboard_setor",
  "sb_dashboard_global",
  "sb_dashboard_tablet",
];

interface UserDrawerProps {
  ponto: number;
  /** Linha da lista (pode faltar se o ponto veio só pela URL). */
  user: UsuarioRecord | null;
  /** Usuários para "copiar permissões de". */
  allUsers: ReadonlyArray<UsuarioRecord>;
  onClose: () => void;
  onChanged: () => void;
  /** Abre o simulador de acesso efetivo (Visão geral) para este usuário. */
  onSimulate?: (ponto: number) => void;
}

interface ProfileDraft {
  nome: string;
  setor: string;
  fornecedor: boolean;
  ipsText: string;
}

interface PermDraft {
  values: PermissionValues;
  painelGlobal: boolean;
  painelTablet: boolean;
  painelSetores: string[];
}

function samePerms(a: PermDraft | null, b: PermDraft | null): boolean {
  if (!a || !b) return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
}

export function UserDrawer({
  ponto,
  user,
  allUsers,
  onClose,
  onChanged,
  onSimulate,
}: UserDrawerProps) {
  const feedback = useFeedback();
  const confirm = useConfirm();
  const permissions = useAuthStore((s) => s.permissions);
  const currentPonto = useAuthStore((s) => s.user?.ponto);
  const setoresQuery = useSetoresLookup();
  const allSetores = useMemo(() => setoresQuery.data ?? [], [setoresQuery.data]);
  const canSeeTerminals = hasPermission(permissions, "sb_admin_ips");
  const ipListQuery = useAdminIpList();

  const internet = user ? hasInternetAccount(user) : false;
  const emailVerified = user?.EmailVerified === true || user?.EmailVerified === 1;

  // ---- Perfil + IPs vinculados ----
  const [profile, setProfile] = useState<ProfileDraft | null>(null);
  const [profileBase, setProfileBase] = useState<ProfileDraft | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);

  // ---- Permissões ----
  const [perms, setPerms] = useState<PermDraft | null>(null);
  const [permsBase, setPermsBase] = useState<PermDraft | null>(null);
  const [permsError, setPermsError] = useState<string | null>(null);
  const [permsSaving, setPermsSaving] = useState(false);
  const [rawPermsState, setRawPermsState] = useState<ReturnType<
    typeof permissionsStateFromResponse
  > | null>(null);
  const [compareTerminalId, setCompareTerminalId] = useState<string>("");
  const [copyFromPonto, setCopyFromPonto] = useState<string>("");
  const [copyBusy, setCopyBusy] = useState(false);

  // ---- Acesso internet ----
  const [authAtivo, setAuthAtivo] = useState<boolean>(() => (user ? isAccountActive(user) : true));
  const [authSaving, setAuthSaving] = useState(false);
  const [passwordLink, setPasswordLink] = useState<PasswordLinkResponse | null>(null);
  const [passwordLinkBusy, setPasswordLinkBusy] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);

  // ---- Foto facial ----
  const [faceStatus, setFaceStatus] = useState<{ has_face: boolean; updated_at?: string } | null>(
    null,
  );
  const [faceBusy, setFaceBusy] = useState(false);

  const [deleting, setDeleting] = useState(false);

  const loadProfile = useCallback(async () => {
    setProfileError(null);
    try {
      const data = await fetchUserIps(ponto);
      const base: ProfileDraft = {
        nome: (user?.Nome ?? "").trim(),
        setor: user?.Setor?.trim() || "SEFOC",
        fornecedor: user ? isFornecedor(user) : false,
        ipsText: data.ips.map((item) => item.ip).join("\n"),
      };
      setProfile(base);
      setProfileBase(base);
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "Erro ao carregar IPs vinculados.");
    }
  }, [ponto, user]);

  const loadPerms = useCallback(async () => {
    setPermsError(null);
    try {
      const data = await fetchUserPermissions(ponto);
      setRawPermsState(permissionsStateFromResponse(data));
    } catch (err) {
      setPermsError(err instanceof Error ? err.message : "Erro ao carregar permissões.");
    }
  }, [ponto]);

  useEffect(() => {
    void loadProfile();
    void loadPerms();
    void fetchUserFaceStatus(ponto)
      .then((face) => setFaceStatus({ has_face: face.has_face, updated_at: face.updated_at }))
      .catch(() => setFaceStatus({ has_face: false }));
    // Carrega uma vez por usuário aberto (o drawer é remontado por ponto).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ponto]);

  // Rascunho de permissões só nasce quando permissões E setores estão carregados
  // (o legado "todos os setores" depende da lista de setores).
  useEffect(() => {
    if (!rawPermsState || setoresQuery.isLoading || permsBase) return;
    const draft: PermDraft = {
      values: rawPermsState.values,
      painelGlobal: rawPermsState.painelGlobal,
      painelTablet: rawPermsState.painelTablet,
      painelSetores: resolvePainelSetoresSelection(rawPermsState, allSetores),
    };
    setPerms(draft);
    setPermsBase(draft);
  }, [allSetores, permsBase, rawPermsState, setoresQuery.isLoading]);

  const profileDirty = Boolean(
    profile && profileBase && JSON.stringify(profile) !== JSON.stringify(profileBase),
  );
  const permsDirty = !samePerms(perms, permsBase);

  const savedCustomized = permsBase
    ? isUserPermissionsCustomized(permsBase.values, permsBase)
    : false;
  const draftCustomized = perms ? isUserPermissionsCustomized(perms.values, perms) : false;
  const showPermissionEditor = internet || savedCustomized;

  const compareTerminal = useMemo(() => {
    if (!compareTerminalId) return null;
    return (ipListQuery.data ?? []).find((ip) => String(ip.id) === compareTerminalId) ?? null;
  }, [compareTerminalId, ipListQuery.data]);

  const referenceValues = useMemo(() => {
    if (!compareTerminal) return null;
    const ref: PermissionValues = {};
    for (const key of IP_PERMISSION_KEYS) {
      ref[key] = readPermissionValue(
        compareTerminal as unknown as Record<string, boolean | number | null | undefined>,
        key,
      );
    }
    return ref;
  }, [compareTerminal]);

  const copyCandidates = useMemo(
    () => allUsers.filter((u) => Number(u.Ponto) !== ponto),
    [allUsers, ponto],
  );

  const handleClose = async () => {
    if (profileDirty || permsDirty) {
      const ok = await confirm({
        title: "Descartar alterações?",
        message: "Há alterações não salvas neste usuário.",
        confirmLabel: "Descartar",
        danger: true,
      });
      if (!ok) return;
    }
    onClose();
  };

  const saveProfile = async () => {
    if (!profile) return;
    const nome = profile.nome.trim();
    if (!nome) {
      feedback.error("Informe o nome do usuário.");
      return;
    }
    if (!profile.setor.trim()) {
      feedback.error("Selecione o setor.");
      return;
    }
    setProfileSaving(true);
    try {
      await updateUserProfile(ponto, {
        nome,
        setor: profile.setor.trim(),
        fornecedor: profile.fornecedor,
      });
      const ips = parseIpsText(profile.ipsText);
      await updateUserIps(ponto, ips);
      const next = { ...profile, nome, ipsText: ips.join("\n") };
      setProfile(next);
      setProfileBase(next);
      feedback.success(`Usuário ${ponto} atualizado.`);
      onChanged();
    } catch (err) {
      feedback.error(err instanceof Error ? err.message : "Erro ao salvar usuário.");
    } finally {
      setProfileSaving(false);
    }
  };

  const savePerms = async () => {
    if (!perms) return;
    if (savedCustomized && !draftCustomized) {
      const ok = await confirm({
        title: "Remover permissões próprias?",
        message:
          "Com tudo desmarcado o usuário deixa de ter permissões próprias: na rede local passa a valer só o terminal e, via internet, nada é liberado.",
        confirmLabel: "Salvar assim",
        danger: true,
      });
      if (!ok) return;
    }
    setPermsSaving(true);
    try {
      await updateUserPermissions(ponto, buildUserPermissionsPayload(perms.values, perms));
      setPermsBase(perms);
      feedback.success(`Permissões salvas (ponto ${ponto}).`);
      onChanged();
    } catch (err) {
      feedback.error(err instanceof Error ? err.message : "Erro ao salvar permissões.");
    } finally {
      setPermsSaving(false);
    }
  };

  const copyPermissionsFrom = async () => {
    const source = Number.parseInt(copyFromPonto, 10);
    if (!source) return;
    setCopyBusy(true);
    try {
      const data = await fetchUserPermissions(source);
      const state = permissionsStateFromResponse(data);
      setPerms({
        values: state.values,
        painelGlobal: state.painelGlobal,
        painelTablet: state.painelTablet,
        painelSetores: resolvePainelSetoresSelection(state, allSetores),
      });
      feedback.success(`Permissões do ponto ${source} copiadas. Revise e clique em Salvar.`);
    } catch (err) {
      feedback.error(err instanceof Error ? err.message : "Erro ao copiar permissões.");
    } finally {
      setCopyBusy(false);
    }
  };

  const toggleAuthAtivo = async (next: boolean) => {
    if (!next) {
      const ok = await confirm({
        title: `Desativar a conta do ponto ${ponto}?`,
        message: "O usuário não conseguirá entrar com senha (acesso via internet).",
        confirmLabel: "Desativar",
        danger: true,
      });
      if (!ok) return;
    }
    setAuthSaving(true);
    try {
      await updateUserPermissions(ponto, { auth_ativo: next });
      setAuthAtivo(next);
      feedback.success(next ? "Conta ativada." : "Conta desativada.");
      onChanged();
    } catch (err) {
      feedback.error(err instanceof Error ? err.message : "Erro ao alterar a conta.");
    } finally {
      setAuthSaving(false);
    }
  };

  const handleGeneratePasswordLink = async () => {
    setPasswordLinkBusy(true);
    try {
      setPasswordLink(await generatePasswordLink(ponto));
      onChanged();
    } catch (err) {
      feedback.error(
        err instanceof Error ? err.message : "Erro ao gerar link de redefinição de senha.",
      );
    } finally {
      setPasswordLinkBusy(false);
    }
  };

  const handleResend = async () => {
    setResendBusy(true);
    try {
      await resendActivation(ponto);
      feedback.success(`E-mail reenviado para ponto ${ponto}.`);
    } catch (err) {
      feedback.error(err instanceof Error ? err.message : "Erro ao reenviar.");
    } finally {
      setResendBusy(false);
    }
  };

  const handleFaceUpload = async (file: File) => {
    setFaceBusy(true);
    try {
      const status = await enrollUserFace(ponto, file);
      setFaceStatus({ has_face: status.has_face, updated_at: status.updated_at });
      feedback.success("Foto facial cadastrada.");
    } catch (err) {
      feedback.error(err instanceof Error ? err.message : "Erro ao cadastrar foto facial.");
    } finally {
      setFaceBusy(false);
    }
  };

  const handleFaceDelete = async () => {
    const ok = await confirm({
      title: "Remover foto facial deste usuário?",
      confirmLabel: "Remover",
      danger: true,
    });
    if (!ok) return;
    setFaceBusy(true);
    try {
      await deleteUserFace(ponto);
      setFaceStatus({ has_face: false });
      feedback.success("Foto facial removida.");
    } catch (err) {
      feedback.error(err instanceof Error ? err.message : "Erro ao remover foto facial.");
    } finally {
      setFaceBusy(false);
    }
  };

  const handleSimulate = async () => {
    if (!onSimulate) return;
    if (profileDirty || permsDirty) {
      const ok = await confirm({
        title: "Sair sem salvar?",
        message: "O simulador usa o que está salvo. As alterações não salvas serão descartadas.",
        confirmLabel: "Descartar e simular",
        danger: true,
      });
      if (!ok) return;
    }
    onSimulate(ponto);
  };

  const canDelete = currentPonto == null || Number(currentPonto) !== Number(ponto);

  const handleDelete = async () => {
    const label = (user?.Nome ?? "").trim() || `ponto ${ponto}`;
    const ok = await confirm({
      title: `Excluir o usuário "${label}" (ponto ${ponto})?`,
      message: "Esta ação não pode ser desfeita.",
      confirmLabel: "Excluir",
      danger: true,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await deleteAuthUser(ponto);
      feedback.success(`Usuário ${ponto} excluído.`);
      onChanged();
      onClose();
    } catch (err) {
      feedback.error(err instanceof Error ? err.message : "Erro ao excluir usuário.");
    } finally {
      setDeleting(false);
    }
  };

  const togglePainelSetor = (setor: string) => {
    setPerms((prev) => {
      if (!prev) return prev;
      const has = prev.painelSetores.includes(setor);
      return {
        ...prev,
        painelSetores: has
          ? prev.painelSetores.filter((s) => s !== setor)
          : [...prev.painelSetores, setor],
      };
    });
  };

  const inputClass =
    "w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-primary-green focus:ring-1 focus:ring-primary-green";

  return (
    <Drawer
      open
      onClose={() => void handleClose()}
      title={(user?.Nome ?? "").trim() || `Ponto ${ponto}`}
      subtitle={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span>Ponto {ponto}</span>
          {user?.Setor ? <span>· {user.Setor}</span> : null}
          {user ? <span>· Último acesso {formatUltimoAcesso(user.UltimoAcesso)}</span> : null}
          {onSimulate ? (
            <button
              type="button"
              onClick={() => void handleSimulate()}
              className="font-semibold text-secondary-blue hover:underline"
            >
              Simular acesso →
            </button>
          ) : null}
        </span>
      }
      footer={
        canDelete ? (
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
            Excluir usuário
          </button>
        ) : (
          <p className="text-xs text-slate-500">Você não pode excluir o próprio usuário.</p>
        )
      }
    >
      <DrawerSection title="Perfil" defaultOpen badge={profileDirty ? <DirtyBadge /> : null}>
        {profileError ? (
          <LoadError text={profileError} onRetry={() => void loadProfile()} />
        ) : !profile ? (
          <SectionLoading />
        ) : (
          <div className="space-y-3">
            <div>
              <label htmlFor="acesso-user-nome" className="mb-1 block text-xs font-medium text-slate-600">
                Nome completo
              </label>
              <input
                id="acesso-user-nome"
                type="text"
                value={profile.nome}
                onChange={(e) => setProfile({ ...profile, nome: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="acesso-user-setor" className="mb-1 block text-xs font-medium text-slate-600">
                Setor
              </label>
              <select
                id="acesso-user-setor"
                value={profile.setor}
                onChange={(e) => setProfile({ ...profile, setor: e.target.value })}
                disabled={setoresQuery.isLoading}
                className={inputClass}
              >
                {!allSetores.includes(profile.setor) ? (
                  <option value={profile.setor}>{profile.setor}</option>
                ) : null}
                {allSetores.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={profile.fornecedor}
                onChange={(e) => setProfile({ ...profile, fornecedor: e.target.checked })}
                className="size-4 accent-primary-green"
              />
              Fornecedor
              <span className="text-xs text-slate-500">(aparece no envio para Gravação Externa)</span>
            </label>
            <div>
              <label htmlFor="acesso-user-ips" className="mb-1 block text-xs font-medium text-slate-600">
                IPs vinculados ao usuário
              </label>
              <textarea
                id="acesso-user-ips"
                rows={3}
                value={profile.ipsText}
                onChange={(e) => setProfile({ ...profile, ipsText: e.target.value })}
                placeholder={"10.1.1.50\n10.1.1.51"}
                className={cn(inputClass, "font-mono")}
              />
              <p className="mt-1 text-xs text-slate-500">
                Um IP por linha. Se informados, entrar na intranet fora destes IPs exige senha.
                Não é o cadastro de terminais — as permissões de cada terminal ficam na aba
                Terminais.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void saveProfile()}
              disabled={profileSaving || !profileDirty}
              className="sagra-btn sagra-btn--primary sagra-btn--md"
            >
              {profileSaving ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Save className="size-4" aria-hidden />
              )}
              Salvar perfil
            </button>
          </div>
        )}
      </DrawerSection>

      <DrawerSection
        title="Acesso internet"
        description="Login com senha fora da rede local. Vale só o que estiver liberado nas permissões deste usuário."
      >
        {!internet ? (
          <p className="text-sm text-slate-600">
            Usuário sem conta internet (sem e-mail nem senha cadastrados). Use “Redefinir senha”
            para gerar o link de ativação, se necessário.
          </p>
        ) : (
          <div className="mb-3 space-y-2 text-sm">
            <p>
              <span className="text-slate-500">E-mail: </span>
              {user?.Email || "—"}
              {!emailVerified ? (
                <span className="ml-1 text-xs font-semibold text-amber-700">(ativação pendente)</span>
              ) : null}
            </p>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={authAtivo}
                disabled={authSaving}
                onChange={(e) => void toggleAuthAtivo(e.target.checked)}
                className="size-4 accent-primary-green"
              />
              Conta ativa
              {authSaving ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
            </label>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {user?.Email?.trim() && !emailVerified ? (
            <button
              type="button"
              onClick={() => void handleResend()}
              disabled={resendBusy}
              className="sagra-btn sagra-btn--outline sagra-btn--sm"
            >
              {resendBusy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Mail className="size-4" aria-hidden />
              )}
              Reenviar ativação
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void handleGeneratePasswordLink()}
            disabled={passwordLinkBusy}
            className="sagra-btn sagra-btn--outline sagra-btn--sm"
          >
            {passwordLinkBusy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <KeyRound className="size-4" aria-hidden />
            )}
            Redefinir senha
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          “Redefinir senha” gera um link para copiar; nenhum e-mail é enviado.
        </p>
        {passwordLink ? (
          <div className="mt-3">
            <CopyableLink
              link={passwordLink.link}
              label={
                passwordLink.tipo === "reset"
                  ? "Link de redefinição de senha"
                  : "Link de ativação da conta"
              }
              hint={
                passwordLink.tipo === "reset"
                  ? "Envie este link ao usuário para redefinir a senha (válido por 24h)."
                  : "A conta ainda não foi ativada: envie este link ao usuário para definir a senha (válido por 48h)."
              }
              onDismiss={() => setPasswordLink(null)}
            />
          </div>
        ) : null}
      </DrawerSection>

      <DrawerSection
        title="Permissões"
        badge={permsDirty ? <DirtyBadge /> : null}
        description={
          <>
            Quando o usuário tem permissões próprias (ao menos uma marcada), elas{" "}
            <strong>substituem por completo</strong> as do terminal — na rede local e via
            internet. Sem nenhuma marcada: na rede local vale o terminal; via internet nada é
            liberado.
          </>
        }
      >
        {permsError ? (
          <LoadError text={permsError} onRetry={() => void loadPerms()} />
        ) : !perms ? (
          <SectionLoading />
        ) : !showPermissionEditor ? (
          <p className="text-sm text-slate-600">
            Usuário sem conta internet e sem permissões próprias: na rede local vale o que estiver
            liberado no terminal em que ele entrar.
          </p>
        ) : (
          <div className="space-y-3">
            <p
              className={cn(
                "rounded-md px-3 py-2 text-xs font-medium",
                draftCustomized
                  ? "bg-sky-50 text-sky-800"
                  : "bg-amber-50 text-amber-800",
              )}
            >
              {draftCustomized
                ? "Permissões próprias ativas: substituem as do terminal."
                : "Sem permissões próprias: vale o terminal na rede local; via internet, nada é liberado."}
            </p>

            <div className="grid gap-2 sm:grid-cols-2">
              {canSeeTerminals ? (
                <label className="block text-xs font-medium text-slate-600">
                  Comparar com terminal
                  <select
                    value={compareTerminalId}
                    onChange={(e) => setCompareTerminalId(e.target.value)}
                    className={cn(inputClass, "mt-1 py-1.5")}
                  >
                    <option value="">— nenhum —</option>
                    {(ipListQuery.data ?? []).map((ip) => (
                      <option key={ip.id} value={String(ip.id)}>
                        {ip.ip}
                        {ip.descricao ? ` — ${ip.descricao}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <div className="text-xs font-medium text-slate-600">
                Copiar permissões de outro usuário
                <div className="mt-1 flex gap-1">
                  <select
                    value={copyFromPonto}
                    onChange={(e) => setCopyFromPonto(e.target.value)}
                    className={cn(inputClass, "min-w-0 py-1.5")}
                    aria-label="Usuário de origem"
                  >
                    <option value="">— escolher —</option>
                    {copyCandidates.map((u) => (
                      <option key={u.Ponto} value={String(u.Ponto)}>
                        {u.Ponto} — {u.Nome || "sem nome"}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => void copyPermissionsFrom()}
                    disabled={!copyFromPonto || copyBusy}
                    className="sagra-btn sagra-btn--outline sagra-btn--sm shrink-0"
                    title="Copiar (não salva automaticamente)"
                  >
                    {copyBusy ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <Copy className="size-4" aria-hidden />
                    )}
                    Copiar
                  </button>
                </div>
              </div>
            </div>

            <PermissionMatrix
              target="user"
              values={perms.values}
              onChange={(values) => setPerms({ ...perms, values })}
              disabled={permsSaving}
              referenceValues={referenceValues}
              referenceLabel={compareTerminal ? `Terminal ${compareTerminal.ip}` : undefined}
              externallyManaged={PAINEL_KEYS}
              externallyManagedHint="Definido na seção Painéis abaixo."
            />

            <fieldset className="rounded-lg border border-slate-200 p-3">
              <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
                Painéis
              </legend>
              <label className="mb-2 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={perms.painelGlobal}
                  onChange={(e) => setPerms({ ...perms, painelGlobal: e.target.checked })}
                  className="size-4 accent-primary-green"
                />
                Painel global
              </label>
              <label className="mb-2 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={perms.painelTablet}
                  onChange={(e) => setPerms({ ...perms, painelTablet: e.target.checked })}
                  className="size-4 accent-primary-green"
                />
                Painel tablet/celular/gravação (sem menu)
              </label>
              <p className="mb-1 text-xs text-slate-600">Painel de setor — setores permitidos:</p>
              <div className="grid max-h-40 grid-cols-2 gap-1.5 overflow-y-auto">
                {allSetores.map((setor) => (
                  <label key={setor} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={perms.painelSetores.includes(setor)}
                      onChange={() => togglePainelSetor(setor)}
                      className="size-4 accent-primary-green"
                    />
                    {setor}
                  </label>
                ))}
              </div>
            </fieldset>

            <button
              type="button"
              onClick={() => void savePerms()}
              disabled={permsSaving || !permsDirty}
              className="sagra-btn sagra-btn--primary sagra-btn--md"
            >
              {permsSaving ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Save className="size-4" aria-hidden />
              )}
              Salvar permissões
            </button>
          </div>
        )}
      </DrawerSection>

      <DrawerSection title="Foto facial (painel tablet)">
        <p className="mb-2 text-sm text-slate-600">
          {faceStatus === null
            ? "Carregando…"
            : faceStatus.has_face
              ? `Cadastrada${faceStatus.updated_at ? ` — ${faceStatus.updated_at}` : ""}`
              : "Nenhuma foto cadastrada"}
        </p>
        <div className="flex flex-wrap gap-2">
          <label
            className={cn(
              "sagra-btn sagra-btn--outline sagra-btn--sm cursor-pointer",
              faceBusy && "pointer-events-none opacity-60",
            )}
          >
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={faceBusy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void handleFaceUpload(file);
              }}
            />
            {faceBusy ? "Enviando…" : "Enviar foto"}
          </label>
          {faceStatus?.has_face ? (
            <button
              type="button"
              disabled={faceBusy}
              onClick={() => void handleFaceDelete()}
              className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Remover
            </button>
          ) : null}
        </div>
      </DrawerSection>
    </Drawer>
  );
}

function DirtyBadge() {
  return (
    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-800">
      não salvo
    </span>
  );
}

function SectionLoading() {
  return (
    <div className="flex items-center gap-2 py-3 text-sm text-slate-500">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      Carregando…
    </div>
  );
}

function LoadError({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      {text}
      <button type="button" onClick={onRetry} className="ml-2 font-semibold underline">
        Tentar novamente
      </button>
    </div>
  );
}
