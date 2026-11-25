import type {
  ManutencaoPedido,
  ManutencaoPrioridade,
  ManutencaoSituacaoRecorrente,
  ManutencaoStatus,
} from "@/api/manutencao";

export const PRIORIDADES: ManutencaoPrioridade[] = ["urgente", "alta", "normal", "baixa"];

export const PRIORIDADE_META: Record<
  ManutencaoPrioridade,
  { label: string; hint: string; badge: string; dot: string; ring: string; bar: string }
> = {
  urgente: {
    label: "Urgente",
    hint: "Produção parada ou risco à segurança — atender imediatamente",
    badge: "bg-red-100 text-red-800 ring-red-200",
    dot: "bg-red-500",
    ring: "ring-red-500 bg-red-50 text-red-900",
    bar: "bg-red-500",
  },
  alta: {
    label: "Alta",
    hint: "Afeta a qualidade ou o ritmo da produção",
    badge: "bg-orange-100 text-orange-800 ring-orange-200",
    dot: "bg-orange-500",
    ring: "ring-orange-500 bg-orange-50 text-orange-900",
    bar: "bg-orange-500",
  },
  normal: {
    label: "Normal",
    hint: "Manutenção comum, sem impacto imediato",
    badge: "bg-sky-100 text-sky-800 ring-sky-200",
    dot: "bg-sky-500",
    ring: "ring-sky-500 bg-sky-50 text-sky-900",
    bar: "bg-sky-500",
  },
  baixa: {
    label: "Baixa",
    hint: "Pode aguardar uma janela sem produção",
    badge: "bg-slate-100 text-slate-700 ring-slate-200",
    dot: "bg-slate-400",
    ring: "ring-slate-400 bg-slate-50 text-slate-900",
    bar: "bg-slate-300",
  },
};

export const STATUS_META: Record<
  ManutencaoStatus,
  { label: string; badge: string; dot: string }
> = {
  fila: { label: "Na fila", badge: "bg-amber-100 text-amber-800 ring-amber-200", dot: "bg-amber-500" },
  em_execucao: {
    label: "Em execução",
    badge: "bg-blue-100 text-blue-800 ring-blue-200",
    dot: "bg-blue-500",
  },
  pausado: {
    label: "Pausado",
    badge: "bg-violet-100 text-violet-800 ring-violet-200",
    dot: "bg-violet-500",
  },
  concluido: {
    label: "Concluído",
    badge: "bg-emerald-100 text-emerald-800 ring-emerald-200",
    dot: "bg-emerald-500",
  },
  cancelado: {
    label: "Cancelado",
    badge: "bg-slate-100 text-slate-600 ring-slate-200",
    dot: "bg-slate-400",
  },
};

export const SITUACAO_RECORRENTE_META: Record<
  ManutencaoSituacaoRecorrente,
  { label: string; badge: string }
> = {
  vencida: { label: "Vencida", badge: "bg-red-100 text-red-800 ring-red-200" },
  vence_em_breve: { label: "Vence em breve", badge: "bg-amber-100 text-amber-800 ring-amber-200" },
  em_dia: { label: "Em dia", badge: "bg-emerald-100 text-emerald-800 ring-emerald-200" },
  sem_historico: { label: "Nunca executada", badge: "bg-slate-100 text-slate-700 ring-slate-200" },
  em_aberto: { label: "Pedido em aberto", badge: "bg-blue-100 text-blue-800 ring-blue-200" },
};

const EVENTO_LABEL: Record<string, string> = {
  criado: "Solicitado",
  atualizado: "Pedido atualizado",
  reordenado: "Fila reordenada",
  iniciado: "Serviço iniciado",
  progresso: "Progresso registrado",
  pausado: "Serviço pausado",
  retomado: "Serviço retomado",
  devolvido: "Devolvido à fila",
  concluido: "Serviço concluído",
  cancelado: "Pedido cancelado",
  comentario: "Comentário",
};

export function eventoLabel(tipo: string): string {
  return EVENTO_LABEL[tipo] ?? tipo;
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "45 min", "3 h 10 min", "2 d 4 h". */
export function formatDuracao(minutos: number | null | undefined): string {
  if (minutos == null || !Number.isFinite(minutos)) return "—";
  const m = Math.max(0, Math.round(minutos));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return rm ? `${h} h ${rm} min` : `${h} h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d} d ${rh} h` : `${d} d`;
}

export function minutosDesde(value: string | null | undefined, now: Date = new Date()): number | null {
  const d = toDate(value);
  if (!d) return null;
  return (now.getTime() - d.getTime()) / 60000;
}

/** "agora", "há 5 min", "há 3 h", "há 2 d". */
export function tempoRelativo(value: string | null | undefined, now: Date = new Date()): string {
  const min = minutosDesde(value, now);
  if (min == null) return "—";
  if (min < 1) return "agora";
  return `há ${formatDuracao(min)}`;
}

export function formatDataHora(value: string | null | undefined): string {
  const d = toDate(value);
  if (!d) return "—";
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatData(value: string | null | undefined): string {
  if (!value) return "—";
  // Datas puras (YYYY-MM-DD) não devem sofrer fuso.
  const pure = /^\d{4}-\d{2}-\d{2}$/.exec(value);
  if (pure) {
    const [y, m, d] = value.split("-");
    return `${d}/${m}/${y}`;
  }
  const d = toDate(value);
  return d ? d.toLocaleDateString("pt-BR") : "—";
}

export function pessoa(nome?: string | null, ponto?: string | null): string {
  if (nome && ponto) return `${nome} (${ponto})`;
  return nome || (ponto ? `Ponto ${ponto}` : "—");
}

/** Move um item da lista (from → to), sem mutar. */
export function moverItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (from < 0 || from >= next.length) return next;
  const clamped = Math.max(0, Math.min(to, next.length - 1));
  const [item] = next.splice(from, 1);
  next.splice(clamped, 0, item as T);
  return next;
}

export function agruparPedidos(pedidos: readonly ManutencaoPedido[]) {
  const fila: ManutencaoPedido[] = [];
  const execucao: ManutencaoPedido[] = [];
  const finalizados: ManutencaoPedido[] = [];
  for (const p of pedidos) {
    if (p.status === "fila") fila.push(p);
    else if (p.status === "em_execucao" || p.status === "pausado") execucao.push(p);
    else finalizados.push(p);
  }
  fila.sort((a, b) => (a.posicao_fila ?? 0) - (b.posicao_fila ?? 0));
  execucao.sort((a, b) => (a.iniciado_em ?? "").localeCompare(b.iniciado_em ?? ""));
  finalizados.sort((a, b) =>
    (b.concluido_em ?? b.cancelado_em ?? "").localeCompare(a.concluido_em ?? a.cancelado_em ?? ""),
  );
  return { fila, execucao, finalizados };
}

export function normalizarBusca(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

export function cleanPonto(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}
