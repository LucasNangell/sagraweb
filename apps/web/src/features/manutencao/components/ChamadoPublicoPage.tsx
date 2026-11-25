import { useMutation, useQuery } from "@tanstack/react-query";
import { cn } from "@sagra/ui";
import {
  AlertOctagon,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Send,
  UserRound,
  Wrench,
} from "lucide-react";
import { useEffect, useState } from "react";

import {
  abrirChamadoPublico,
  fetchMaquinaPublica,
  fetchNomePublicoPorPonto,
  type ManutencaoPrioridade,
} from "@/api/manutencao";
import { sagraBtn } from "@/components/ui/sagraBtn";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

import { STATUS_META, tempoRelativo } from "../manutencaoUi";
import { errorMessage } from "../useManutencaoData";
import { Badge, Field, inputClass, PrioridadeSelector } from "./ManutencaoShared";

type Etapa = "descricao" | "identificacao" | "enviado";

export function ChamadoPublicoPage({ codigo }: { codigo: string }) {
  const maquinaQ = useQuery({
    queryKey: ["manutencao-publico", "maquina", codigo],
    queryFn: () => fetchMaquinaPublica(codigo),
    retry: false,
  });

  const [etapa, setEtapa] = useState<Etapa>("descricao");
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [prioridade, setPrioridade] = useState<ManutencaoPrioridade>("normal");
  const [parada, setParada] = useState(false);
  const [ponto, setPonto] = useState("");
  const [nome, setNome] = useState("");
  const [tentou, setTentou] = useState(false);

  const pontoLimpo = ponto.replace(/\D/g, "");
  const pontoDebounced = useDebouncedValue(pontoLimpo, 400);
  const nomeQ = useQuery({
    queryKey: ["manutencao-publico", "ponto", pontoDebounced],
    queryFn: () => fetchNomePublicoPorPonto(pontoDebounced),
    enabled: etapa === "identificacao" && pontoDebounced.length >= 1,
    retry: false,
    staleTime: 60_000,
  });
  const nomeCadastrado = pontoDebounced === pontoLimpo ? nomeQ.data?.nome ?? null : null;
  const pontoConsultado =
    pontoLimpo.length > 0 && pontoDebounced === pontoLimpo && nomeQ.isSuccess;
  const precisaNome = pontoConsultado && !nomeCadastrado;

  const enviar = useMutation({
    mutationFn: abrirChamadoPublico,
    onSuccess: () => setEtapa("enviado"),
  });

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [etapa]);

  const novoChamado = () => {
    setTitulo("");
    setDescricao("");
    setPrioridade("normal");
    setParada(false);
    setTentou(false);
    enviar.reset();
    setEtapa("descricao");
    void maquinaQ.refetch();
  };

  const continuar = () => {
    setTentou(true);
    if (!titulo.trim()) return;
    setTentou(false);
    setEtapa("identificacao");
  };

  const confirmar = () => {
    setTentou(true);
    if (!pontoLimpo || !pontoConsultado) return;
    if (precisaNome && nome.trim().length < 3) return;
    enviar.mutate({
      codigo,
      titulo: titulo.trim(),
      descricao: descricao.trim() || null,
      prioridade,
      maquina_parada: parada,
      ponto: pontoLimpo,
      nome: precisaNome ? nome.trim() : null,
    });
  };

  const maquina = maquinaQ.data;

  return (
    <div className="min-h-dvh bg-slate-100">
      <header className="bg-slate-900 px-4 pb-16 pt-6 text-white">
        <div className="mx-auto flex max-w-lg items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10">
            <Wrench className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <p className="text-xs uppercase tracking-widest text-slate-400">SAGRA · Manutenção</p>
            <h1 className="text-lg font-semibold">Abrir chamado de manutenção</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto -mt-12 max-w-lg px-3 pb-10">
        {maquinaQ.isLoading ? (
          <Card>
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Identificando a máquina…
            </div>
          </Card>
        ) : maquinaQ.isError || !maquina ? (
          <Card>
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <AlertTriangle className="h-8 w-8 text-amber-500" aria-hidden />
              <p className="font-semibold text-slate-800">Máquina não encontrada</p>
              <p className="text-sm text-slate-500">
                O código <span className="font-mono font-semibold">{codigo}</span> não corresponde a
                uma máquina ativa. Procure a gerência da Gráfica.
              </p>
            </div>
          </Card>
        ) : (
          <div className="space-y-3">
            <Card>
              <div className="flex items-start gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Máquina
                  </p>
                  <p className="text-xl font-bold text-slate-900">{maquina.nome}</p>
                  <p className="mt-0.5 flex items-center gap-2 text-sm text-slate-500">
                    <span className="rounded border border-slate-300 px-1.5 font-mono text-xs font-semibold text-slate-700">
                      {maquina.codigo}
                    </span>
                    {maquina.setor}
                  </p>
                </div>
                {maquina.parada ? (
                  <Badge className="bg-red-600 text-white ring-red-700">
                    <AlertOctagon className="h-3 w-3" aria-hidden />
                    Parada
                  </Badge>
                ) : null}
              </div>
              {maquina.pedidos_abertos.length && etapa !== "enviado" ? (
                <div className="border-t border-amber-200 bg-amber-50 px-4 py-3">
                  <p className="text-sm font-semibold text-amber-900">
                    Já existe {maquina.pedidos_abertos.length === 1 ? "1 chamado" : `${maquina.pedidos_abertos.length} chamados`} em aberto para esta máquina:
                  </p>
                  <ul className="mt-1 space-y-1">
                    {maquina.pedidos_abertos.map((p) => (
                      <li key={p.id} className="flex flex-wrap items-center gap-1.5 text-sm text-amber-900">
                        <Badge className={STATUS_META[p.status].badge}>{STATUS_META[p.status].label}</Badge>
                        <span className="font-medium">{p.titulo}</span>
                        <span className="text-xs text-amber-700">· {tempoRelativo(p.solicitado_em)}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-xs text-amber-800">
                    Se for o mesmo problema, não é preciso abrir outro chamado.
                  </p>
                </div>
              ) : null}
            </Card>

            {etapa !== "enviado" ? <Passos etapa={etapa} /> : null}

            {etapa === "descricao" ? (
              <Card>
                <div className="space-y-5 p-4">
                  <Field label="O que está acontecendo?" required htmlFor="ch-titulo">
                    <input
                      id="ch-titulo"
                      className={cn(inputClass, tentou && !titulo.trim() && "border-red-400")}
                      value={titulo}
                      maxLength={200}
                      onChange={(e) => setTitulo(e.target.value)}
                      placeholder="Ex.: Papel enroscando na saída"
                      autoFocus
                    />
                    {tentou && !titulo.trim() ? (
                      <p className="text-xs font-medium text-red-600">Descreva o problema em poucas palavras.</p>
                    ) : null}
                  </Field>
                  <Field label="Detalhes" hint="Quando começou, barulhos, mensagens no painel, o que já foi tentado." htmlFor="ch-desc">
                    <textarea
                      id="ch-desc"
                      className={cn(inputClass, "min-h-[110px] resize-y")}
                      value={descricao}
                      maxLength={5000}
                      onChange={(e) => setDescricao(e.target.value)}
                    />
                  </Field>
                  <Field label="Prioridade">
                    <PrioridadeSelector value={prioridade} onChange={setPrioridade} />
                  </Field>
                  <label
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-3",
                      parada ? "border-red-300 bg-red-50" : "border-slate-200",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-5 w-5 accent-red-600"
                      checked={parada}
                      onChange={(e) => {
                        setParada(e.target.checked);
                        if (e.target.checked) setPrioridade("urgente");
                      }}
                    />
                    <span>
                      <span className="block text-sm font-semibold text-slate-800">A máquina está parada</span>
                      <span className="block text-xs text-slate-500">A produção nesta máquina está interrompida.</span>
                    </span>
                  </label>
                  <button
                    type="button"
                    className={cn(sagraBtn("next", "lg"), "w-full justify-center")}
                    onClick={continuar}
                  >
                    Continuar
                  </button>
                </div>
              </Card>
            ) : null}

            {etapa === "identificacao" ? (
              <Card>
                <div className="space-y-5 p-4">
                  <div className="rounded-lg bg-slate-50 p-3 text-sm">
                    <p className="font-semibold text-slate-800">{titulo}</p>
                    {descricao ? <p className="mt-0.5 line-clamp-3 text-slate-600">{descricao}</p> : null}
                    <button
                      type="button"
                      className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-slate-600 underline-offset-2 hover:underline"
                      onClick={() => setEtapa("descricao")}
                    >
                      <ArrowLeft className="h-3 w-3" aria-hidden />
                      Editar
                    </button>
                  </div>
                  <Field label="Seu número de ponto" required htmlFor="ch-ponto">
                    <input
                      id="ch-ponto"
                      className={cn(inputClass, "text-lg tracking-wider", tentou && !pontoLimpo && "border-red-400")}
                      inputMode="numeric"
                      autoComplete="off"
                      value={ponto}
                      maxLength={10}
                      onChange={(e) => setPonto(e.target.value.replace(/\D/g, ""))}
                      placeholder="Ex.: 12345"
                      autoFocus
                    />
                  </Field>
                  {pontoLimpo ? (
                    nomeQ.isFetching || pontoDebounced !== pontoLimpo ? (
                      <p className="flex items-center gap-2 text-sm text-slate-500">
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        Buscando cadastro…
                      </p>
                    ) : nomeQ.isError ? (
                      <p className="text-sm text-red-600">{errorMessage(nomeQ.error)}</p>
                    ) : nomeCadastrado ? (
                      <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
                        <UserRound className="h-5 w-5 text-emerald-600" aria-hidden />
                        <div>
                          <p className="text-xs text-emerald-700">Solicitante</p>
                          <p className="font-semibold text-emerald-900">{nomeCadastrado}</p>
                        </div>
                      </div>
                    ) : precisaNome ? (
                      <Field
                        label="Seu nome completo"
                        required
                        hint="Ponto ainda não cadastrado — seu nome ficará registrado no sistema."
                        htmlFor="ch-nome"
                      >
                        <input
                          id="ch-nome"
                          className={cn(inputClass, tentou && nome.trim().length < 3 && "border-red-400")}
                          value={nome}
                          maxLength={120}
                          autoComplete="name"
                          onChange={(e) => setNome(e.target.value)}
                        />
                      </Field>
                    ) : null
                  ) : null}
                  {enviar.isError ? (
                    <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                      {errorMessage(enviar.error)}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    className={cn(sagraBtn("confirm", "lg"), "w-full justify-center")}
                    onClick={confirmar}
                    disabled={
                      enviar.isPending ||
                      !pontoConsultado ||
                      (precisaNome && nome.trim().length < 3)
                    }
                  >
                    <Send className="h-4 w-4" aria-hidden />
                    {enviar.isPending ? "Enviando…" : "Confirmar e abrir chamado"}
                  </button>
                </div>
              </Card>
            ) : null}

            {etapa === "enviado" && enviar.data ? (
              <Card>
                <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
                  <span className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100">
                    <CheckCircle2 className="h-8 w-8 text-emerald-600" aria-hidden />
                  </span>
                  <p className="text-lg font-semibold text-slate-900">Chamado #{enviar.data.id} aberto!</p>
                  <p className="text-sm text-slate-600">
                    Obrigado, {enviar.data.solicitante_nome}. A equipe de manutenção foi notificada
                    {enviar.data.posicao_fila ? ` e o chamado está em ${enviar.data.posicao_fila}º na fila` : ""}.
                  </p>
                  <button type="button" className={sagraBtn("outline", "md")} onClick={novoChamado}>
                    Abrir outro chamado
                  </button>
                </div>
              </Card>
            ) : null}
          </div>
        )}
      </main>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <section className="overflow-hidden rounded-2xl bg-white shadow-lg ring-1 ring-slate-200">{children}</section>;
}

function Passos({ etapa }: { etapa: Etapa }) {
  const itens = [
    { id: "descricao", label: "1. O problema" },
    { id: "identificacao", label: "2. Identificação" },
  ] as const;
  return (
    <ol className="grid grid-cols-2 gap-2 px-1">
      {itens.map((it) => {
        const ativo = it.id === etapa;
        const feito = etapa === "identificacao" && it.id === "descricao";
        return (
          <li
            key={it.id}
            className={cn(
              "rounded-full px-3 py-1.5 text-center text-xs font-semibold",
              ativo ? "bg-slate-900 text-white" : feito ? "bg-emerald-100 text-emerald-800" : "bg-white text-slate-500",
            )}
          >
            {it.label}
          </li>
        );
      })}
    </ol>
  );
}
