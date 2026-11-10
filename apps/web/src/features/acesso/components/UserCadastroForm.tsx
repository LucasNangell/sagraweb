import { Loader2, UserPlus } from "lucide-react";
import { useState } from "react";

import { createAuthUser } from "@/api/adminUsers";
import { useSetoresLookup } from "@/api/hooks/useAuxLookups";
import { EmailGalLookupField } from "@/features/email/components/EmailGalLookupField";
import { sanitizePontoDigits } from "@/lib/format";

import { CopyableLink } from "./CopyableLink";

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
        className="mt-4 inline-flex w-full cursor-pointer sagra-btn sagra-btn--primary sagra-btn--md transition hover:bg-primary-green/90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
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
