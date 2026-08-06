import { useQuery } from "@tanstack/react-query";
import { Building2, Landmark, Loader2, Mail, Trash2, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";

import {
  adminCreateCliente,
  adminDeleteCliente,
  adminFetchClienteVinculoOpcoes,
  adminListClientes,
  adminResendClienteActivation,
  adminUpdateClienteNav,
  type ClienteTipoConta,
} from "@/api/cliente-portal";

const TIPO_OPTIONS: Array<{ id: ClienteTipoConta; label: string }> = [
  { id: "gabinete", label: "Gabinete" },
  { id: "orgao", label: "Órgão" },
];

function tipoLabel(tipo?: string | null) {
  return tipo === "orgao" ? "Órgão" : "Gabinete";
}

export function ClienteCadastroForm({
  onSuccess,
  onError,
}: {
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [tipoConta, setTipoConta] = useState<ClienteTipoConta>("gabinete");
  const [vinculo, setVinculo] = useState("");
  const [creating, setCreating] = useState(false);
  const [resendingId, setResendingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [navSavingId, setNavSavingId] = useState<number | null>(null);

  const listQuery = useQuery({
    queryKey: ["admin", "clientes"],
    queryFn: adminListClientes,
  });

  const opcoesQuery = useQuery({
    queryKey: ["admin", "clientes", "vinculo-opcoes", tipoConta],
    queryFn: () => adminFetchClienteVinculoOpcoes(tipoConta),
    enabled: tipoConta === "orgao",
  });

  useEffect(() => {
    setVinculo("");
  }, [tipoConta]);

  const handleCreate = async () => {
    if (!nome.trim() || !email.trim() || !vinculo.trim()) {
      onError(`Informe nome, e-mail e ${tipoLabel(tipoConta).toLowerCase()}.`);
      return;
    }
    setCreating(true);
    try {
      const res = await adminCreateCliente({
        nome: nome.trim(),
        email: email.trim(),
        tipo_conta: tipoConta,
        vinculo: vinculo.trim(),
      });
      onSuccess(
        `Cliente do ${tipoLabel(res.tipo_conta).toLowerCase()} "${res.gabinete}" cadastrado. E-mail de ativação enviado para ${res.email}.`,
      );
      setNome("");
      setEmail("");
      setVinculo("");
      void listQuery.refetch();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Erro ao cadastrar cliente.");
    } finally {
      setCreating(false);
    }
  };

  const handleResend = async (id: number) => {
    setResendingId(id);
    try {
      await adminResendClienteActivation(id);
      onSuccess("E-mail de ativação reenviado.");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Falha ao reenviar ativação.");
    } finally {
      setResendingId(null);
    }
  };

  const handleNavToggle = async (clienteId: number, enabled: boolean) => {
    setNavSavingId(clienteId);
    try {
      await adminUpdateClienteNav(clienteId, { nav_credencial_depol: enabled });
      onSuccess(
        enabled
          ? "Credencial DEPOL habilitada no portal do cliente."
          : "Credencial DEPOL desabilitada no portal do cliente.",
      );
      void listQuery.refetch();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Falha ao atualizar menu do cliente.");
    } finally {
      setNavSavingId(null);
    }
  };

  const handleDelete = async (cliente: {
    ID: number;
    Nome: string;
    Email: string;
    ParentID: number | null;
  }) => {
    const principalWarning =
      cliente.ParentID === null
        ? "\n\nContas subordinadas vinculadas a esta conta principal também serão removidas."
        : "";
    const ok = window.confirm(
      `Tem certeza que deseja excluir o cliente "${cliente.Nome}" (${cliente.Email}) do portal externo?\nEsta ação não pode ser desfeita.${principalWarning}`,
    );
    if (!ok) return;

    setDeletingId(cliente.ID);
    try {
      await adminDeleteCliente(cliente.ID);
      onSuccess(`Cliente "${cliente.Nome}" excluído.`);
      void listQuery.refetch();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Erro ao excluir cliente.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-secondary-blue">
        <Building2 className="size-5" aria-hidden />
        Cadastrar cliente (portal externo)
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        Conta vinculada ao <strong>gabinete</strong> (GabSalaUsuario) ou ao{" "}
        <strong>órgão</strong> (NomeUsuario / solicitante nas OSs de órgão). O cliente receberá e-mail
        para criar senha e acessar <code className="rounded bg-slate-100 px-1">/cliente</code>.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Tipo de conta</label>
          <select
            value={tipoConta}
            onChange={(e) => setTipoConta(e.target.value as ClienteTipoConta)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            {TIPO_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Nome</label>
          <input
            type="text"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="Nome do responsável"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">E-mail (login)</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="cliente@exemplo.br"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            {tipoConta === "orgao" ? "Órgão" : "Gabinete (como na OS)"}
          </label>
          {tipoConta === "orgao" ? (
            <select
              value={vinculo}
              onChange={(e) => setVinculo(e.target.value)}
              disabled={opcoesQuery.isLoading}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:opacity-60"
            >
              <option value="">
                {opcoesQuery.isLoading ? "Carregando órgãos…" : "Selecione o órgão"}
              </option>
              {(opcoesQuery.data ?? []).map((orgao) => (
                <option key={orgao} value={orgao}>
                  {orgao}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={vinculo}
              onChange={(e) => setVinculo(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="Ex.: 940 ou Dep. Fulano de Tal"
            />
          )}
        </div>
      </div>

      {tipoConta === "orgao" && opcoesQuery.isError ? (
        <p className="mt-2 text-xs text-red-600">
          Não foi possível carregar a lista de órgãos. Tente novamente.
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => void handleCreate()}
        disabled={creating}
        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-secondary-blue px-4 py-2.5 text-sm font-semibold text-white hover:bg-secondary-blue/90 disabled:opacity-60"
      >
        {creating ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <UserPlus className="size-4" />
        )}
        Cadastrar cliente
      </button>

      {listQuery.data && listQuery.data.length > 0 ? (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-600">
                <th className="px-2 py-2">Tipo</th>
                <th className="px-2 py-2">Vínculo</th>
                <th className="px-2 py-2">Nome</th>
                <th className="px-2 py-2">E-mail</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2">Credencial DEPOL</th>
                <th className="px-2 py-2">Ações</th>
              </tr>
            </thead>
            <tbody>
              {listQuery.data.map((c) => (
                <tr key={c.ID} className="border-b border-slate-100">
                  <td className="px-2 py-2">
                    <span className="inline-flex items-center gap-1 text-xs">
                      {c.TipoConta === "orgao" ? (
                        <Landmark className="size-3.5" aria-hidden />
                      ) : (
                        <Building2 className="size-3.5" aria-hidden />
                      )}
                      {tipoLabel(c.TipoConta)}
                    </span>
                  </td>
                  <td className="px-2 py-2">{c.Gabinete}</td>
                  <td className="px-2 py-2">{c.Nome}</td>
                  <td className="px-2 py-2">{c.Email}</td>
                  <td className="px-2 py-2 text-xs">
                    {c.EmailVerified ? "Ativo" : "Pendente ativação"}
                    {c.ParentID ? " · subconta" : ""}
                  </td>
                  <td className="px-2 py-2">
                    <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                      <input
                        type="checkbox"
                        className="size-4 rounded border-slate-300"
                        checked={Boolean(c.NavCredencialDepol)}
                        disabled={navSavingId === c.ID || deletingId === c.ID}
                        onChange={(e) => void handleNavToggle(c.ID, e.target.checked)}
                      />
                      {navSavingId === c.ID ? (
                        <Loader2 className="size-3 animate-spin text-slate-400" />
                      ) : (
                        <span>{c.NavCredencialDepol ? "Ativa" : "Off"}</span>
                      )}
                    </label>
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {!c.EmailVerified ? (
                        <button
                          type="button"
                          disabled={resendingId === c.ID || deletingId === c.ID}
                          onClick={() => void handleResend(c.ID)}
                          className="inline-flex items-center gap-1 text-xs text-secondary-blue hover:underline disabled:opacity-50"
                        >
                          {resendingId === c.ID ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <Mail className="size-3" />
                          )}
                          Reenviar ativação
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={deletingId === c.ID || resendingId === c.ID}
                        onClick={() => void handleDelete(c)}
                        className="inline-flex items-center gap-1 text-xs text-red-700 hover:underline disabled:opacity-50"
                      >
                        {deletingId === c.ID ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Trash2 className="size-3" />
                        )}
                        Excluir
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
