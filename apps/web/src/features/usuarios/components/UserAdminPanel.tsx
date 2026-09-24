import {
  Check,
  Copy,
  KeyRound,
  Loader2,
  Mail,
  Pencil,
  Save,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { createContext, useCallback, useContext, useRef, useState } from "react";

import {
  createAuthUser,
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
import { useSetoresLookup } from "@/api/hooks/useAuxLookups";
import { CONTEXT_PERMISSION_COLUMNS } from "@/features/admin-ips/constants";
import { useAuthStore } from "@/features/auth/authStore";
import { PERMISSION_KEYS, type PermissionKey } from "@/features/auth/types";
import {
  deleteUserFace,
  enrollUserFace,
  fetchUserFaceStatus,
} from "@/features/dashboard-tablet/api";
import { EmailGalLookupField } from "@/features/email/components/EmailGalLookupField";
import { sanitizePontoDigits } from "@/lib/format";

// ctx_prova_web é administrável apenas por usuário (não existe na tela de IPs).
const CONTEXT_PERMISSIONS: PermissionKey[] = [
  ...CONTEXT_PERMISSION_COLUMNS.map((c) => c.key),
  "ctx_prova_web",
];

const SIDEBAR_PERMISSIONS = PERMISSION_KEYS.filter(
  (k) =>
    k.startsWith("sb_") &&
    k !== "sb_dashboard_setor" &&
    k !== "sb_dashboard_global" &&
    k !== "sb_dashboard_tablet",
);

const PERMISSION_LABELS: Partial<Record<PermissionKey, string>> = {
  ctx_nova_os: "Nova OS",
  ctx_duplicar_os: "Duplicar OS",
  ctx_editar_os: "Editar OS",
  ctx_vincular_os: "Vincular OS",
  ctx_abrir_pasta: "Abrir pasta",
  ctx_mover_pastas: "Mover pastas",
  ctx_imprimir_ficha: "Imprimir ficha",
  ctx_detalhes_os: "Detalhes da OS",
  ctx_prova_web: "Prova WEB",
  ctx_orcamento: "Orçamento",
  sb_inicio: "Início",
  sb_gerencia: "Gerência",
  sb_email: "E-mail",
  sb_analise: "Análise",
  sb_papelaria: "Papelaria",
  sb_usuario: "Usuário",
  sb_configuracoes: "Configurações",
  sb_relatorio: "Relatórios",
  sb_admin_ips: "Admin IPs",
  sb_pcp: "PCP",
  sb_usuarios: "Usuários",
  sb_active_computers: "Computadores",
  sb_gravacao: "Gravação",
  sb_gravacao_externa: "Gravação Externa",
  sb_gravacao_pendente: "Gravações Pendentes",
  sb_gravacao_externa_operador: "Operador Grv. Externa",
  sb_gravacao_pendente_excluir: "Excluir controle de chapas",
  sb_gravacao_externa_entrega: "Lançar recebimento das chapas",
  sb_gravacao_externa_lancar: "Lançar gravação externa",
  sb_cotas_graf: "Cotas Graf",
  sb_estoque: "Estoque (operador)",
  sb_estoque_gerente: "Estoque (gerente)",
  sb_lombada: "Lombada",
  sb_dashboard_tablet: "Painel tablet",
  sb_credenciais_depol: "Credenciais DEPOL",
  sb_manipular_imagem: "Manipular Imagem",
};

interface UserAdminActions {
  openEditUser: (
    ponto: number,
    nome: string | null | undefined,
    setor: string | null | undefined,
    fornecedor?: boolean | number | null,
  ) => void;
  openPermissions: (ponto: number) => void;
  handleResend: (ponto: number) => void;
  handleDelete: (ponto: number, nome?: string | null) => void;
}

const UserAdminActionsContext = createContext<UserAdminActions | null>(null);

export function useUserAdminActions(): UserAdminActions | null {
  return useContext(UserAdminActionsContext);
}

interface UserAdminProviderProps {
  children: React.ReactNode;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
  onUserUpdated?: () => void;
}

function CopyableLink({
  link,
  label,
  hint,
  onDismiss,
}: {
  link: string;
  label: string;
  hint?: string;
  onDismiss?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const handleCopy = async () => {
    let ok = false;
    // navigator.clipboard só existe em contexto seguro (HTTPS/localhost); a intranet usa HTTP.
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(link);
        ok = true;
      } catch {
        ok = false;
      }
    }
    if (!ok && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
    }
    setCopyFailed(!ok);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">{label}</p>
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            className="cursor-pointer rounded p-0.5 text-emerald-800 hover:bg-emerald-100"
            aria-label="Fechar link"
          >
            <X className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          readOnly
          value={link}
          aria-label={label}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs"
        />
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          {copied ? (
            <Check className="size-3.5 text-primary-green" aria-hidden />
          ) : (
            <Copy className="size-3.5" aria-hidden />
          )}
          {copied ? "Copiado" : "Copiar"}
        </button>
      </div>
      {hint ? <p className="mt-1 text-xs text-slate-600">{hint}</p> : null}
      {copyFailed ? (
        <p className="mt-1 text-xs text-red-700">
          Não foi possível copiar automaticamente. Selecione o link e use Ctrl+C.
        </p>
      ) : null}
    </div>
  );
}

export function UserCadastroForm({
  onSuccess,
  onError,
  onCreated,
}: {
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
  onCreated?: () => void;
}) {
  const setoresQuery = useSetoresLookup();
  const setoresList = setoresQuery.data ?? [];

  const [ponto, setPonto] = useState("");
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [setor, setSetor] = useState("SEFOC");
  const [fornecedor, setFornecedor] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createdLink, setCreatedLink] = useState<{ ponto: number; link: string } | null>(null);
  const hasEmail = Boolean(email.trim());

  const pontoGalQuery = (() => {
    const digits = sanitizePontoDigits(ponto);
    return digits ? `P_${digits}` : "";
  })();

  const handleCreate = async () => {
    const pontoNum = Number.parseInt(sanitizePontoDigits(ponto), 10);
    if (!pontoNum) {
      onError("Informe um ponto válido (apenas números).");
      return;
    }
    if (!nome.trim()) {
      onError("Informe o nome completo.");
      return;
    }
    if (!setor.trim()) {
      onError("Selecione o setor.");
      return;
    }

    setCreating(true);
    setCreatedLink(null);
    try {
      const result = await createAuthUser({
        ponto: pontoNum,
        nome: nome.trim(),
        email: email.trim() || null,
        setor: setor.trim(),
        fornecedor,
      });
      const activationLink = result?.activation_link;
      if (activationLink) {
        setCreatedLink({ ponto: pontoNum, link: activationLink });
      }
      const detalhe = activationLink
        ? "Copie o link abaixo e envie ao usuário para definir a senha."
        : "E-mail de ativação enviado.";
      onSuccess(
        fornecedor
          ? `Usuário ${pontoNum} cadastrado como Fornecedor. ${detalhe} Conceda também a permissão "Gravação Externa" se necessário.`
          : `Usuário ${pontoNum} cadastrado. ${detalhe}`,
      );
      setPonto("");
      setNome("");
      setEmail("");
      setFornecedor(false);
      onCreated?.();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Erro ao cadastrar usuário.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-secondary-blue">
        <UserPlus className="size-5" aria-hidden />
        Cadastrar usuário (acesso internet)
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        Apenas MASTER. Com e-mail, o usuário recebe o link de ativação por e-mail; sem e-mail, o
        link para definir a senha é exibido aqui para ser copiado. O login pode ser feito pelo
        ponto.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label htmlFor="cadastro-ponto" className="mb-1 block text-xs font-medium text-slate-600">
            Ponto (apenas números)
          </label>
          <input
            id="cadastro-ponto"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="Somente dígitos, ex.: 918713"
            value={ponto}
            onChange={(e) => setPonto(sanitizePontoDigits(e.target.value))}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-primary-green focus:ring-1 focus:ring-primary-green"
          />
          <p className="mt-0.5 text-xs text-slate-500">
            Informe o ponto numérico do usuário, sem letras ou símbolos.
          </p>
        </div>
        <div>
          <label htmlFor="cadastro-nome" className="mb-1 block text-xs font-medium text-slate-600">
            Nome completo
          </label>
          <input
            id="cadastro-nome"
            type="text"
            placeholder="Nome do usuário"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-primary-green focus:ring-1 focus:ring-primary-green"
          />
        </div>
        <div>
          <EmailGalLookupField
            variant="form"
            label="E-mail (opcional)"
            inputId="cadastro-email"
            value={email}
            onChange={setEmail}
            fallbackQuery={pontoGalQuery}
            onToast={onSuccess}
            onError={onError}
          />
          <p className="mt-0.5 text-xs text-slate-500">
            Opcional. Informe o e-mail ou use a lupa para buscar no catálogo pelo ponto (P_…), nome
            ou e-mail.
          </p>
        </div>
        <div>
          <label htmlFor="cadastro-setor" className="mb-1 block text-xs font-medium text-slate-600">
            Setor
          </label>
          <select
            id="cadastro-setor"
            value={setor}
            onChange={(e) => setSetor(e.target.value)}
            disabled={setoresQuery.isLoading}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-primary-green focus:ring-1 focus:ring-primary-green"
          >
            {setoresList.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={fornecedor}
          onChange={(e) => setFornecedor(e.target.checked)}
          className="size-4 rounded border-slate-300 text-primary-green focus:ring-primary-green"
        />
        <span>
          Fornecedor{" "}
          <span className="text-xs text-slate-500">
            (aparece no envio para Gravação Externa; use a permissão &quot;Gravação Externa&quot;
            para o acesso)
          </span>
        </span>
      </label>

      <button
        type="button"
        disabled={creating}
        onClick={() => void handleCreate()}
        className="mt-4 inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-primary-green px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-green/90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
      >
        {creating ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <UserPlus className="size-4" aria-hidden />
        )}
        {hasEmail ? "Cadastrar e enviar e-mail" : "Cadastrar"}
      </button>

      {createdLink ? (
        <div className="mt-4">
          <CopyableLink
            link={createdLink.link}
            label={`Link para definir senha — ponto ${createdLink.ponto}`}
            hint="Envie este link ao usuário para definir a senha (válido por 48h)."
            onDismiss={() => setCreatedLink(null)}
          />
        </div>
      ) : null}
    </section>
  );
}

export function UserAdminProvider({
  children,
  onSuccess,
  onError,
  onUserUpdated,
}: UserAdminProviderProps) {
  const setoresQuery = useSetoresLookup();
  const [editPonto, setEditPonto] = useState<number | null>(null);
  const [editNome, setEditNome] = useState("");
  const [editSetor, setEditSetor] = useState("SEFOC");
  const [editFornecedor, setEditFornecedor] = useState(false);
  const [editIps, setEditIps] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [passwordLink, setPasswordLink] = useState<PasswordLinkResponse | null>(null);
  const [passwordLinkBusy, setPasswordLinkBusy] = useState(false);
  const [permPonto, setPermPonto] = useState<number | null>(null);
  const [permLoading, setPermLoading] = useState(false);
  const [permSaving, setPermSaving] = useState(false);
  const [permValues, setPermValues] = useState<Partial<Record<PermissionKey, boolean>>>(
    {},
  );
  const [authAtivo, setAuthAtivo] = useState(true);
  const [permPainelGlobal, setPermPainelGlobal] = useState(false);
  const [permPainelTablet, setPermPainelTablet] = useState(false);
  const [permPainelSetores, setPermPainelSetores] = useState<Set<string>>(new Set());
  const [faceStatus, setFaceStatus] = useState<{
    has_face: boolean;
    updated_at?: string;
  } | null>(null);
  const [faceBusy, setFaceBusy] = useState(false);

  const allSetores = setoresQuery.data ?? [];

  const togglePainelSetor = (setor: string) => {
    setPermPainelSetores((prev) => {
      const next = new Set(prev);
      if (next.has(setor)) {
        next.delete(setor);
      } else {
        next.add(setor);
      }
      return next;
    });
  };

  const openEditUser = useCallback(
    async (
      pontoNum: number,
      nome?: string | null,
      setor?: string | null,
      fornecedor?: boolean | number | null,
    ) => {
      setEditPonto(pontoNum);
      setEditNome((nome ?? "").trim());
      setEditSetor(setor?.trim() || "SEFOC");
      setEditFornecedor(fornecedor === true || fornecedor === 1);
      setPasswordLink(null);
      setFaceStatus(null);
      try {
        const data = await fetchUserIps(pontoNum);
        setEditIps(data.ips.map((item) => item.ip).join("\n"));
      } catch {
        setEditIps("");
      }
      try {
        const face = await fetchUserFaceStatus(pontoNum);
        setFaceStatus({ has_face: face.has_face, updated_at: face.updated_at });
      } catch {
        setFaceStatus({ has_face: false });
      }
    },
    [],
  );

  const closeEditUser = () => {
    setEditPonto(null);
    setPasswordLink(null);
  };

  const handleGeneratePasswordLink = async () => {
    if (editPonto === null) return;
    setPasswordLinkBusy(true);
    try {
      const result = await generatePasswordLink(editPonto);
      setPasswordLink(result);
      onUserUpdated?.();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Erro ao gerar link de redefinição de senha.");
    } finally {
      setPasswordLinkBusy(false);
    }
  };

  const saveEditUser = async () => {
    if (editPonto === null) return;
    const nome = editNome.trim();
    if (!nome) {
      onError("Informe o nome do usuário.");
      return;
    }
    if (!editSetor.trim()) {
      onError("Selecione o setor.");
      return;
    }
    setEditSaving(true);
    try {
      await updateUserProfile(editPonto, {
        nome,
        setor: editSetor.trim(),
        fornecedor: editFornecedor,
      });
      const ips = editIps
        .split(/[\n,;]+/)
        .map((ip) => ip.trim())
        .filter(Boolean);
      await updateUserIps(editPonto, ips);
      onSuccess(`Usuário ${editPonto} atualizado.`);
      closeEditUser();
      onUserUpdated?.();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Erro ao salvar usuário.");
    } finally {
      setEditSaving(false);
    }
  };

  const openPermissions = useCallback(
    async (pontoNum: number) => {
      setPermPonto(pontoNum);
      setPermLoading(true);
      try {
        const data = await fetchUserPermissions(pontoNum);
        const values: Partial<Record<PermissionKey, boolean>> = {};
        for (const key of PERMISSION_KEYS) {
          if (
            key === "sb_dashboard_setor" ||
            key === "sb_dashboard_global" ||
            key === "sb_dashboard_tablet"
          ) {
            continue;
          }
          values[key] = Boolean(data[key]);
        }
        setPermValues(values);
        setAuthAtivo(true);
        setPermPainelGlobal(Boolean(data.sb_dashboard_global));
        setPermPainelTablet(Boolean(data.sb_dashboard_tablet));

        const explicit = (data.painel_setores ?? []).map((s) => String(s).trim()).filter(Boolean);
        const legacyAll =
          Boolean(data.painel_setores_legacy_all) ||
          (Boolean(data.sb_dashboard_setor) && explicit.length === 0);
        setPermPainelSetores(
          legacyAll ? new Set(allSetores) : new Set(explicit),
        );
      } catch (err) {
        onError(err instanceof Error ? err.message : "Erro ao carregar permissões.");
        setPermPonto(null);
      } finally {
        setPermLoading(false);
      }
    },
    [allSetores, onError],
  );

  const handleResend = async (pontoNum: number) => {
    try {
      await resendActivation(pontoNum);
      onSuccess(`E-mail reenviado para ponto ${pontoNum}.`);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Erro ao reenviar.");
    }
  };

  const handleDelete = async (pontoNum: number, nome?: string | null) => {
    const label = (nome ?? "").trim() || `ponto ${pontoNum}`;
    const ok = window.confirm(
      `Tem certeza que deseja excluir o usuário "${label}" (ponto ${pontoNum})?\nEsta ação não pode ser desfeita.`,
    );
    if (!ok) return;

    try {
      await deleteAuthUser(pontoNum);
      onSuccess(`Usuário ${pontoNum} excluído.`);
      if (editPonto === pontoNum) closeEditUser();
      if (permPonto === pontoNum) setPermPonto(null);
      onUserUpdated?.();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Erro ao excluir usuário.");
    }
  };

  const savePermissions = async () => {
    if (permPonto === null) return;
    setPermSaving(true);
    try {
      const painelSetoresList = Array.from(permPainelSetores);
      await updateUserPermissions(permPonto, {
        ...permValues,
        auth_ativo: authAtivo,
        sb_dashboard_global: permPainelGlobal,
        sb_dashboard_tablet: permPainelTablet,
        painel_setores: painelSetoresList,
        sb_dashboard_setor: painelSetoresList.length > 0,
      });
      onSuccess(`Permissões salvas (ponto ${permPonto}).`);
      setPermPonto(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Erro ao salvar.");
    } finally {
      setPermSaving(false);
    }
  };

  return (
    <UserAdminActionsContext.Provider
      value={{ openEditUser, openPermissions, handleResend, handleDelete }}
    >
      {children}

      {editPonto !== null ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Editar usuário — Ponto {editPonto}</h3>
              <button
                type="button"
                onClick={closeEditUser}
                className="cursor-pointer rounded p-1 hover:bg-slate-100"
                aria-label="Fechar"
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label
                  htmlFor="edit-nome"
                  className="mb-1 block text-xs font-medium text-slate-600"
                >
                  Nome completo
                </label>
                <input
                  id="edit-nome"
                  type="text"
                  value={editNome}
                  onChange={(e) => setEditNome(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label
                  htmlFor="edit-setor"
                  className="mb-1 block text-xs font-medium text-slate-600"
                >
                  Setor
                </label>
                <select
                  id="edit-setor"
                  value={editSetor}
                  onChange={(e) => setEditSetor(e.target.value)}
                  disabled={setoresQuery.isLoading}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                  {(setoresQuery.data ?? []).map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={editFornecedor}
                  onChange={(e) => setEditFornecedor(e.target.checked)}
                  className="size-4 rounded border-slate-300 text-primary-green focus:ring-primary-green"
                />
                Fornecedor
              </label>
              <div>
                <label
                  htmlFor="edit-ips"
                  className="mb-1 block text-xs font-medium text-slate-600"
                >
                  IPs cadastrados
                </label>
                <textarea
                  id="edit-ips"
                  rows={4}
                  value={editIps}
                  onChange={(e) => setEditIps(e.target.value)}
                  placeholder={"10.1.1.50\n10.1.1.51"}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
                />
                <p className="mt-1 text-xs text-slate-500">
                  Um IP por linha (ou separados por vírgula). Se informados, acesso na intranet
                  fora destes IPs exige senha.
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Senha (acesso internet)
                </p>
                <p className="mb-2 text-xs text-slate-600">
                  Gera um link para o usuário definir uma nova senha. Nenhum e-mail é enviado.
                </p>
                <button
                  type="button"
                  onClick={() => void handleGeneratePasswordLink()}
                  disabled={passwordLinkBusy || editPonto === null}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {passwordLinkBusy ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <KeyRound className="size-4" aria-hidden />
                  )}
                  Redefinir senha
                </button>
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
                    />
                  </div>
                ) : null}
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Foto facial (painel tablet)
                </p>
                <p className="mb-2 text-xs text-slate-600">
                  {faceStatus?.has_face
                    ? `Cadastrada${faceStatus.updated_at ? ` — ${faceStatus.updated_at}` : ""}`
                    : "Nenhuma foto cadastrada"}
                </p>
                <div className="flex flex-wrap gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={faceBusy || editPonto === null}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (!file || editPonto === null) return;
                        setFaceBusy(true);
                        void enrollUserFace(editPonto, file)
                          .then((status) => {
                            setFaceStatus({
                              has_face: status.has_face,
                              updated_at: status.updated_at,
                            });
                            onSuccess("Foto facial cadastrada.");
                          })
                          .catch((err) => {
                            onError(
                              err instanceof Error
                                ? err.message
                                : "Erro ao cadastrar foto facial.",
                            );
                          })
                          .finally(() => setFaceBusy(false));
                      }}
                    />
                    {faceBusy ? "Enviando…" : "Enviar foto"}
                  </label>
                  {faceStatus?.has_face ? (
                    <button
                      type="button"
                      className="rounded-md border border-red-200 px-3 py-2 text-sm text-red-700"
                      disabled={faceBusy || editPonto === null}
                      onClick={() => {
                        if (editPonto === null) return;
                        if (!window.confirm("Remover foto facial deste usuário?")) return;
                        setFaceBusy(true);
                        void deleteUserFace(editPonto)
                          .then(() => {
                            setFaceStatus({ has_face: false });
                            onSuccess("Foto facial removida.");
                          })
                          .catch((err) => {
                            onError(
                              err instanceof Error
                                ? err.message
                                : "Erro ao remover foto facial.",
                            );
                          })
                          .finally(() => setFaceBusy(false));
                      }}
                    >
                      Remover
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void saveEditUser()}
              disabled={editSaving}
              className="mt-4 flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-primary-green py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {editSaving ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Save className="size-4" aria-hidden />
              )}
              Salvar
            </button>
          </div>
        </div>
      ) : null}

      {permPonto !== null ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Permissões — Ponto {permPonto}</h3>
              <button
                type="button"
                onClick={() => setPermPonto(null)}
                className="cursor-pointer rounded p-1 hover:bg-slate-100"
                aria-label="Fechar"
              >
                <X className="size-5" />
              </button>
            </div>
            {permLoading ? (
              <Loader2 className="mx-auto size-8 animate-spin text-primary-green" />
            ) : (
              <>
                <label className="mb-4 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={authAtivo}
                    onChange={(e) => setAuthAtivo(e.target.checked)}
                  />
                  Conta ativa
                </label>

                <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50/80 p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Painéis
                  </p>
                  <label className="mb-3 flex items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={permPainelGlobal}
                      onChange={(e) => setPermPainelGlobal(e.target.checked)}
                    />
                    Painel global
                  </label>
                  <label className="mb-3 flex items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={permPainelTablet}
                      onChange={(e) => setPermPainelTablet(e.target.checked)}
                    />
                    Painel tablet/celular (URL /painel/tablet ou /painel/celular — sem menu)
                  </label>
                  <p className="mb-2 text-xs text-slate-600">
                    Painel de setor / tablet — marque cada setor permitido:
                  </p>
                  <div className="grid max-h-40 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
                    {allSetores.map((setor) => (
                      <label
                        key={setor}
                        className="flex items-center gap-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={permPainelSetores.has(setor)}
                          onChange={() => togglePainelSetor(setor)}
                        />
                        {setor}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50/80 p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Menu de contexto (prevalece sobre o IP)
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {CONTEXT_PERMISSIONS.map((key) => (
                      <label key={key} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={Boolean(permValues[key])}
                          onChange={(e) =>
                            setPermValues((p) => ({ ...p, [key]: e.target.checked }))
                          }
                        />
                        {PERMISSION_LABELS[key] ?? key}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {SIDEBAR_PERMISSIONS.map((key) => (
                    <label key={key} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={Boolean(permValues[key])}
                        onChange={(e) =>
                          setPermValues((p) => ({ ...p, [key]: e.target.checked }))
                        }
                      />
                      {PERMISSION_LABELS[key] ?? key}
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => void savePermissions()}
                  disabled={permSaving}
                  className="mt-4 flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-primary-green py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {permSaving ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Save className="size-4" />
                  )}
                  Salvar
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}
    </UserAdminActionsContext.Provider>
  );
}

export function UserRowActions({
  ponto,
  nome,
  setor,
  fornecedor,
  email,
  emailVerified,
  contaInternet,
}: {
  ponto: number;
  nome?: string | null;
  setor?: string | null;
  fornecedor?: boolean | number | null;
  email?: string | null;
  emailVerified?: number | boolean | null;
  contaInternet?: number | boolean | null;
}) {
  const actions = useUserAdminActions();
  const currentPonto = useAuthStore((s) => s.user?.ponto);
  if (!actions) return null;

  const verified = emailVerified === true || emailVerified === 1;
  const hasEmail = Boolean(email?.trim());
  const hasInternetAccount = hasEmail || contaInternet === true || contaInternet === 1;
  const canDelete = currentPonto == null || Number(currentPonto) !== Number(ponto);

  return (
    <div className="flex flex-wrap gap-1">
      <button
        type="button"
        onClick={() => actions.openEditUser(ponto, nome, setor, fornecedor)}
        className="inline-flex cursor-pointer items-center gap-1 rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50"
      >
        <Pencil className="size-3" aria-hidden />
        Editar
      </button>
      {hasInternetAccount ? (
        <button
          type="button"
          onClick={() => void actions.openPermissions(ponto)}
          className="cursor-pointer rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50"
        >
          Permissões
        </button>
      ) : null}
      {hasEmail && !verified ? (
        <button
          type="button"
          onClick={() => void actions.handleResend(ponto)}
          className="inline-flex cursor-pointer items-center gap-1 rounded border border-amber-300 px-2 py-0.5 text-xs text-amber-800 hover:bg-amber-50"
        >
          <Mail className="size-3" aria-hidden />
          Reenviar
        </button>
      ) : null}
      {canDelete ? (
        <button
          type="button"
          onClick={() => void actions.handleDelete(ponto, nome)}
          className="inline-flex cursor-pointer items-center gap-1 rounded border border-red-300 px-2 py-0.5 text-xs text-red-700 hover:bg-red-50"
        >
          <Trash2 className="size-3" aria-hidden />
          Excluir
        </button>
      ) : null}
    </div>
  );
}

/** @deprecated Use UserRowActions */
export const UserAuthActions = UserRowActions;
