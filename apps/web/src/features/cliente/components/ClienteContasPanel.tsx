import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, UserPlus, Users } from "lucide-react";
import { useState } from "react";

import {
  createClienteSubConta,
  fetchClienteContas,
} from "@/api/cliente-portal";

export function ClienteContasPanel() {
  const qc = useQueryClient();
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const contasQuery = useQuery({
    queryKey: ["cliente", "contas"],
    queryFn: fetchClienteContas,
  });

  const createMutation = useMutation({
    mutationFn: () => createClienteSubConta({ nome: nome.trim(), email: email.trim() }),
    onSuccess: (data) => {
      setMsg(`Conta criada. E-mail de ativação enviado para ${data.email}.`);
      setErr(null);
      setNome("");
      setEmail("");
      void qc.invalidateQueries({ queryKey: ["cliente", "contas"] });
    },
    onError: (e: Error) => {
      setErr(e.message);
      setMsg(null);
    },
  });

  return (
    <section className="rounded-2xl border border-sagra-border bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-start gap-3 border-b border-sagra-border/70 pb-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary-blue/10 text-secondary-blue">
          <Users className="size-5" aria-hidden />
        </span>
        <div>
          <h2 className="text-base font-bold text-secondary-blue">Contas do gabinete</h2>
          <p className="mt-1 text-sm text-neutral-600">
            Crie logins adicionais para que outras pessoas do gabinete acompanhem as OSs.
          </p>
        </div>
      </div>

      {contasQuery.isLoading ? (
        <p className="mt-4 text-sm text-neutral-500">Carregando contas…</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {(contasQuery.data ?? []).map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between rounded-md border border-sagra-border px-3 py-2 text-sm"
            >
              <span>
                <strong>{c.nome}</strong> — {c.email}
              </span>
              <span className="text-xs text-neutral-500">
                {c.is_principal ? "Principal" : "Subconta"}
              </span>
            </li>
          ))}
        </ul>
      )}

      <form
        className="mt-5 grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!nome.trim() || !email.trim()) {
            setErr("Informe nome e e-mail.");
            return;
          }
          createMutation.mutate();
        }}
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-neutral-700">Nome</span>
          <input
            className="rounded-lg border border-sagra-border px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary-blue"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-neutral-700">E-mail (login)</span>
          <input
            type="email"
            className="rounded-lg border border-sagra-border px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary-blue"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-secondary-blue px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-secondary-blue/90 disabled:opacity-60"
          >
            {createMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <UserPlus className="size-4" />
            )}
            Criar conta
          </button>
        </div>
      </form>

      {msg ? <p className="mt-3 text-sm text-primary-green">{msg}</p> : null}
      {err ? <p className="mt-3 text-sm text-red-700">{err}</p> : null}
    </section>
  );
}
