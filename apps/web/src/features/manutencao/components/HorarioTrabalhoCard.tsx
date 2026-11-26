import { cn } from "@sagra/ui";
import { useQuery } from "@tanstack/react-query";
import { BellOff, BellRing, Clock, Loader2, Moon } from "lucide-react";
import { useState } from "react";

import {
  fetchManutencaoHorario,
  manutencaoKeys,
  salvarManutencaoHorario,
  type ManutencaoHorario,
} from "@/api/manutencao";
import { sagraBtn } from "@/components/ui/sagraBtn";

import { useManutencaoMutation } from "../useManutencaoData";

/** Dias ISO (1 = segunda … 7 = domingo), na ordem da semana de trabalho. */
const DIAS: { iso: number; curto: string; nome: string }[] = [
  { iso: 1, curto: "Seg", nome: "Segunda" },
  { iso: 2, curto: "Ter", nome: "Terça" },
  { iso: 3, curto: "Qua", nome: "Quarta" },
  { iso: 4, curto: "Qui", nome: "Quinta" },
  { iso: 5, curto: "Sex", nome: "Sexta" },
  { iso: 6, curto: "Sáb", nome: "Sábado" },
  { iso: 7, curto: "Dom", nome: "Domingo" },
];

const PADRAO: ManutencaoHorario = {
  ativo: false,
  dias: [1, 2, 3, 4, 5],
  inicio: "07:00",
  fim: "17:00",
  urgentes_fora: false,
};

/** "Seg a Sex", "Seg, Qua e Sex", "Todos os dias". */
export function resumoDias(dias: number[]): string {
  const ord = [...new Set(dias)].filter((d) => d >= 1 && d <= 7).sort((a, b) => a - b);
  if (!ord.length) return "Nenhum dia";
  if (ord.length === 7) return "Todos os dias";
  const nome = (d: number) => DIAS[d - 1]?.curto ?? String(d);
  const primeiro = ord[0] as number;
  const ultimo = ord[ord.length - 1] as number;
  const seguidos = ord.every((d, i) => i === 0 || d === (ord[i - 1] as number) + 1);
  if (seguidos && ord.length >= 3) return `${nome(primeiro)} a ${nome(ultimo)}`;
  if (ord.length === 1) return nome(primeiro);
  return `${ord.slice(0, -1).map(nome).join(", ")} e ${nome(ultimo)}`;
}

export function resumoHorario(h: Pick<ManutencaoHorario, "dias" | "inicio" | "fim">): string {
  const intervalo = h.inicio === h.fim ? "dia inteiro" : `${h.inicio}–${h.fim}`;
  return `${resumoDias(h.dias)}, ${intervalo}`;
}

/**
 * Cartão do operador: horário de trabalho. Fora dele o celular (app Android e
 * Web Push) não toca; os chamados continuam na fila e na central de notificações.
 */
export function HorarioTrabalhoCard() {
  const horarioQ = useQuery({
    queryKey: manutencaoKeys.horario,
    queryFn: fetchManutencaoHorario,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
  const [editando, setEditando] = useState(false);

  if (horarioQ.isLoading || horarioQ.isError) return null;
  const atual = horarioQ.data ?? PADRAO;

  if (editando) {
    return <HorarioEditor inicial={atual} onFechar={() => setEditando(false)} />;
  }

  const foraAgora = atual.ativo && atual.avisando_agora === false;
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-3 py-2 text-sm",
        foraAgora ? "border-indigo-200 bg-indigo-50 text-indigo-900" : "border-slate-200 bg-white text-slate-700",
      )}
    >
      {foraAgora ? (
        <Moon className="h-4 w-4 shrink-0 text-indigo-500" aria-hidden />
      ) : (
        <Clock className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
      )}
      <span className="min-w-0 flex-1">
        {atual.ativo ? (
          <>
            <span className="font-medium">Avisos no meu horário:</span> {resumoHorario(atual)}
            {foraAgora ? (
              <span className="block text-xs text-indigo-700">
                Fora do horário agora — o celular não vai tocar
                {atual.urgentes_fora ? " (exceto chamados urgentes)" : ""}.
              </span>
            ) : null}
          </>
        ) : (
          <>
            <span className="font-medium">Avisos a qualquer hora.</span>{" "}
            <span className="text-slate-500">Defina seu horário para não ser avisado fora do expediente.</span>
          </>
        )}
      </span>
      <button type="button" className={sagraBtn("outline", "sm")} onClick={() => setEditando(true)}>
        {atual.ativo ? "Alterar" : "Definir horário"}
      </button>
    </div>
  );
}

function HorarioEditor({ inicial, onFechar }: { inicial: ManutencaoHorario; onFechar: () => void }) {
  const [ativo, setAtivo] = useState(true); // abrir o editor já é para definir o horário
  const [dias, setDias] = useState<number[]>(inicial.dias.length ? inicial.dias : PADRAO.dias);
  const [inicio, setInicio] = useState(inicial.inicio || PADRAO.inicio);
  const [fim, setFim] = useState(inicial.fim || PADRAO.fim);
  const [urgentesFora, setUrgentesFora] = useState(inicial.urgentes_fora);

  const salvar = useManutencaoMutation(salvarManutencaoHorario, {
    success: (r) => (r.ativo ? `Horário salvo: ${resumoHorario(r)}` : "Avisos liberados a qualquer hora"),
    onSuccess: onFechar,
  });

  const alternarDia = (iso: number) =>
    setDias((atual) => (atual.includes(iso) ? atual.filter((d) => d !== iso) : [...atual, iso].sort((a, b) => a - b)));

  const semDias = ativo && dias.length === 0;
  const horasOk = /^\d{2}:\d{2}$/.test(inicio) && /^\d{2}:\d{2}$/.test(fim);
  const atravessaMeiaNoite = horasOk && inicio > fim;

  const enviar = (comAtivo: boolean) =>
    salvar.mutate({ ativo: comAtivo, dias, inicio, fim, urgentes_fora: urgentesFora });

  return (
    <section className="rounded-xl border border-slate-300 bg-white p-4 shadow-sm" aria-label="Horário de trabalho">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white">
          <Clock className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-900">Meu horário de trabalho</p>
          <p className="mt-0.5 text-sm text-slate-600">
            O celular só avisa de novos chamados dentro deste horário. Fora dele, os chamados continuam na fila e
            na central de notificações.
          </p>
        </div>
      </div>

      <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-800">
        <input
          type="checkbox"
          className="h-4 w-4 accent-slate-900"
          checked={ativo}
          onChange={(e) => setAtivo(e.target.checked)}
        />
        Só avisar no meu horário de trabalho
      </label>

      <fieldset className={cn("mt-3 flex flex-col gap-3", !ativo && "pointer-events-none opacity-50")} disabled={!ativo}>
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Dias</p>
          <div className="flex flex-wrap gap-1.5">
            {DIAS.map((d) => {
              const on = dias.includes(d.iso);
              return (
                <button
                  key={d.iso}
                  type="button"
                  aria-pressed={on}
                  aria-label={d.nome}
                  onClick={() => alternarDia(d.iso)}
                  className={cn(
                    "min-w-[3rem] rounded-lg border px-2.5 py-2 text-sm font-semibold transition",
                    on
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-300 bg-white text-slate-600 hover:border-slate-500",
                  )}
                >
                  {d.curto}
                </button>
              );
            })}
          </div>
          {semDias ? <p className="mt-1 text-xs text-red-600">Escolha ao menos um dia.</p> : null}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Início
            <input
              type="time"
              value={inicio}
              onChange={(e) => setInicio(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-base font-normal text-slate-900"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Fim
            <input
              type="time"
              value={fim}
              onChange={(e) => setFim(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-base font-normal text-slate-900"
              required
            />
          </label>
        </div>
        {atravessaMeiaNoite ? (
          <p className="flex items-center gap-1.5 text-xs text-indigo-700">
            <Moon className="h-3.5 w-3.5" aria-hidden />
            Turno da noite: vai das {inicio} até as {fim} do dia seguinte.
          </p>
        ) : null}
        {horasOk && inicio === fim ? (
          <p className="text-xs text-slate-500">Início igual ao fim: avisa o dia inteiro nos dias marcados.</p>
        ) : null}

        <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-red-600"
            checked={urgentesFora}
            onChange={(e) => setUrgentesFora(e.target.checked)}
          />
          <span>
            Avisar chamados <strong className="text-red-700">urgentes</strong> mesmo fora do horário
          </span>
        </label>
      </fieldset>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className={sagraBtn("save", "md")}
          disabled={salvar.isPending || semDias || !horasOk}
          onClick={() => enviar(ativo)}
        >
          {salvar.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : ativo ? (
            <BellRing className="h-4 w-4" aria-hidden />
          ) : (
            <BellOff className="h-4 w-4" aria-hidden />
          )}
          Salvar
        </button>
        <button type="button" className={sagraBtn("cancel", "md")} onClick={onFechar} disabled={salvar.isPending}>
          Cancelar
        </button>
      </div>
    </section>
  );
}
