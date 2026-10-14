export interface GravacaoOsGroupableItem {
  nr_os: number;
  ano: number;
  componente?: string | null;
  membros?: { nr_os: number; ano: number }[];
}

export interface GravacaoOsGroup<T extends GravacaoOsGroupableItem> {
  /** Chave estável: OSs da juntada (ou a própria OS) ordenadas. */
  key: string;
  /** Item usado para OS/rótulos do card (primeiro na ordem da lista). */
  anchor: T;
  /** Sessões do card, ordenadas por componente (Capa, Miolo, Todos) e id. */
  sessions: T[];
}

const COMPONENTE_ORDER: Record<string, number> = { capa: 0, miolo: 1, todos: 2 };

export function gravacaoOsGroupKey(item: GravacaoOsGroupableItem): string {
  const membros = item.membros?.length ? item.membros : [{ nr_os: item.nr_os, ano: item.ano }];
  const unique = new Map<string, { nr_os: number; ano: number }>();
  for (const m of membros) {
    unique.set(`${m.ano}-${m.nr_os}`, m);
  }
  return [...unique.values()]
    .sort((a, b) => a.ano - b.ano || a.nr_os - b.nr_os)
    .map((m) => `${m.ano}-${m.nr_os}`)
    .join("|");
}

/**
 * Agrupa as sessões da lista (uma por componente/envio) em um card por OS.
 * Juntadas permanecem juntas porque a chave considera todas as OSs membro.
 */
export function groupGravacaoItemsByOs<T extends GravacaoOsGroupableItem>(
  items: readonly T[],
  getSessionId: (item: T) => number | null | undefined,
): GravacaoOsGroup<T>[] {
  const groups = new Map<string, GravacaoOsGroup<T>>();
  for (const item of items) {
    const key = gravacaoOsGroupKey(item);
    const group = groups.get(key);
    if (group) {
      group.sessions.push(item);
    } else {
      groups.set(key, { key, anchor: item, sessions: [item] });
    }
  }
  for (const group of groups.values()) {
    group.sessions.sort((a, b) => {
      const ca = COMPONENTE_ORDER[a.componente ?? "todos"] ?? 3;
      const cb = COMPONENTE_ORDER[b.componente ?? "todos"] ?? 3;
      if (ca !== cb) return ca - cb;
      return (getSessionId(a) ?? 0) - (getSessionId(b) ?? 0);
    });
  }
  return [...groups.values()];
}

export function gravacaoComponenteLabel(componente?: string | null): string | null {
  return componente === "capa" ? "Capa" : componente === "miolo" ? "Miolo" : null;
}
