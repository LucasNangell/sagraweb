import { cn } from "@sagra/ui";
import { CheckCircle2, FlaskConical, Loader2, ShieldX } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";

import {
  useAccessPreview,
  type AccessPermissionSource,
  type AccessPreviewOrigem,
  type AccessPreviewParams,
} from "@/api/acesso";
import { useUsuariosList } from "@/api/hooks/useUsuariosQueries";

import { groupCatalogByCategory } from "../permissionCatalog";

const SOURCE_LABEL: Record<AccessPermissionSource, string> = {
  master: "MASTER",
  ip: "Terminal",
  user: "Usuário",
};

interface AccessSimulatorProps {
  /** Ponto pré-selecionado (ex.: vindo do painel do usuário). */
  initialPonto?: number;
}

/**
 * Simulador de acesso efetivo: a resposta vem do backend, que usa a mesma regra do
 * middleware. Nenhuma lógica de mesclagem é reproduzida aqui.
 */
export function AccessSimulator({ initialPonto }: AccessSimulatorProps) {
  const usersQuery = useUsuariosList();
  const users = useMemo(() => usersQuery.data ?? [], [usersQuery.data]);

  const [ponto, setPonto] = useState(initialPonto ? String(initialPonto) : "");
  const [origem, setOrigem] = useState<AccessPreviewOrigem>("local");
  const [ip, setIp] = useState("");
  const [params, setParams] = useState<AccessPreviewParams | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const preview = useAccessPreview(params);

  const selectedUser = users.find((u) => String(u.Ponto) === ponto.trim());
  const ipSuggestions = useMemo(() => {
    const set = new Set<string>();
    if (selectedUser?.IPUltimoAcesso) set.add(selectedUser.IPUltimoAcesso);
    for (const item of selectedUser?.IpsCadastrados ?? []) set.add(item);
    return [...set];
  }, [selectedUser]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const pontoNum = Number.parseInt(ponto.trim(), 10);
    if (!pontoNum || pontoNum <= 0) {
      setFormError("Informe o ponto do usuário.");
      return;
    }
    if (origem === "local" && !ip.trim()) {
      setFormError("Informe o IP do computador (rede local).");
      return;
    }
    setFormError(null);
    setParams({ ponto: pontoNum, ip: ip.trim(), origem });
  };

  const data = preview.data;
  const groups = useMemo(() => groupCatalogByCategory(), []);
  const inputClass =
    "h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm outline-none focus:border-primary-green focus:ring-1 focus:ring-primary-green";

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="flex items-center gap-2 text-base font-semibold text-slate-800">
        <FlaskConical className="size-5 text-secondary-blue" aria-hidden />
        Simulador de acesso efetivo
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        O que este usuário consegue acessar a partir deste computador? O resultado é calculado
        pelo servidor com a mesma regra usada no login.
      </p>

      <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_1fr_auto] sm:items-end">
        <label className="block text-xs font-medium text-slate-600">
          Usuário (ponto)
          <input
            type="text"
            inputMode="numeric"
            list="acesso-sim-usuarios"
            value={ponto}
            onChange={(e) => setPonto(e.target.value.replace(/\D/g, ""))}
            placeholder="Ex.: 918713"
            className={cn(inputClass, "mt-1")}
          />
          <datalist id="acesso-sim-usuarios">
            {users.map((u) => (
              <option key={u.Ponto} value={String(u.Ponto)}>
                {u.Nome ?? ""}
              </option>
            ))}
          </datalist>
          {selectedUser?.Nome ? (
            <span className="mt-0.5 block truncate text-[11px] text-slate-500">{selectedUser.Nome}</span>
          ) : null}
        </label>
        <fieldset className="block text-xs font-medium text-slate-600">
          <legend>Origem</legend>
          <div className="mt-1 flex h-9 overflow-hidden rounded-md border border-slate-300">
            {(
              [
                ["local", "Rede local"],
                ["internet", "Internet"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={origem === value}
                onClick={() => setOrigem(value)}
                className={cn(
                  "px-3 text-sm font-semibold",
                  origem === value ? "bg-secondary-blue text-white" : "bg-white text-slate-600",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="block text-xs font-medium text-slate-600">
          IP do computador
          <input
            type="text"
            list="acesso-sim-ips"
            value={origem === "internet" ? "" : ip}
            disabled={origem === "internet"}
            onChange={(e) => setIp(e.target.value)}
            placeholder={origem === "internet" ? "Não se aplica (internet)" : "Ex.: 10.120.1.12"}
            className={cn(inputClass, "mt-1 font-mono disabled:bg-slate-50")}
          />
          <datalist id="acesso-sim-ips">
            {ipSuggestions.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
        </label>
        <button type="submit" className="sagra-btn sagra-btn--primary sagra-btn--md">
          {preview.isFetching ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          Simular
        </button>
      </form>

      {formError ? (
        <p className="mt-2 text-sm text-red-700" role="alert">
          {formError}
        </p>
      ) : null}

      {preview.isError ? (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {preview.error instanceof Error ? preview.error.message : "Erro ao simular."}
        </p>
      ) : null}

      {data && !preview.isError ? (
        <div className="mt-4 space-y-3" data-testid="access-simulator-result">
          <div
            className={cn(
              "flex items-start gap-3 rounded-lg border px-4 py-3",
              data.acesso ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50",
            )}
          >
            {data.acesso ? (
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-700" aria-hidden />
            ) : (
              <ShieldX className="mt-0.5 size-5 shrink-0 text-red-700" aria-hidden />
            )}
            <div className="min-w-0 text-sm">
              <p className={cn("font-semibold", data.acesso ? "text-emerald-900" : "text-red-900")}>
                {data.acesso ? "Acesso permitido" : "Acesso negado"}
              </p>
              <p className="text-slate-700">{data.descricao}</p>
              <p className="mt-1 text-xs text-slate-600">
                {data.usuario
                  ? `${data.usuario.nome ?? "Sem nome"} (ponto ${data.usuario.ponto}) · ${
                      data.usuario.permissoes_proprias ? "com permissões próprias" : "sem permissões próprias"
                    }${data.origem === "internet" && !data.usuario.conta_ativa ? " · conta inativa" : ""}`
                  : `Ponto ${data.ponto} não cadastrado em Usuários.`}
                {data.terminal
                  ? data.terminal.privilegiado
                    ? " · Terminal MASTER/servidor"
                    : data.terminal.cadastro
                      ? ` · Terminal ${data.terminal.cadastro.ip}${
                          data.terminal.cadastro.descricao ? ` (${data.terminal.cadastro.descricao})` : ""
                        }${data.terminal.cadastro.curinga ? " — por curinga" : ""}`
                      : " · IP sem terminal ativo"
                  : ""}
              </p>
            </div>
          </div>

          {data.permissoes ? (
            <div className="grid gap-3 md:grid-cols-2">
              {groups.map((group) => {
                const granted = group.entries.filter((item) => data.permissoes?.[item.key]);
                return (
                  <div key={group.id} className="rounded-lg border border-slate-200">
                    <p className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {group.label}
                      <span className="font-normal normal-case">
                        {granted.length}/{group.entries.length}
                      </span>
                    </p>
                    <ul className="divide-y divide-slate-100">
                      {group.entries.map((item) => {
                        const on = Boolean(data.permissoes?.[item.key]);
                        const source = data.origem_por_chave[item.key];
                        return (
                          <li key={item.key} className="flex items-center gap-2 px-3 py-1 text-sm">
                            <span
                              className={cn(
                                "size-2 shrink-0 rounded-full",
                                on ? "bg-emerald-500" : "bg-slate-300",
                              )}
                              aria-hidden
                            />
                            <span className={cn("min-w-0 flex-1 truncate", !on && "text-slate-400")}>
                              {item.label}
                            </span>
                            <span className="sr-only">{on ? "liberado" : "bloqueado"}</span>
                            {source ? (
                              <span className="shrink-0 text-[10px] font-semibold uppercase text-slate-400">
                                {SOURCE_LABEL[source]}
                              </span>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          ) : null}

          {data.permissoes && (data.painel_setores.length > 0 || data.painel_setores_legacy_all) ? (
            <p className="text-xs text-slate-600">
              Painel de setor:{" "}
              {data.painel_setores_legacy_all ? "todos os setores" : data.painel_setores.join(", ")}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
