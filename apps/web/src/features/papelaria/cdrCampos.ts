import type {
  PapelariaCdrSemNomeEdit,
  PapelariaOsCdrCampos,
} from "./types";

/** Prefixo das chaves de campos vindos do .cdr da OS (portal e página). */
export const CDR_FIELD_PREFIX = "cdr:";

export type CdrSemNomeDraft = { texto?: string; nome?: string };

export type CdrAlteracoes = {
  textos: Record<string, string>;
  semNome: PapelariaCdrSemNomeEdit[];
  count: number;
};

/** Só o que difere do retrato atual entra no pedido ao worker. */
export function computeCdrAlteracoes(
  data: PapelariaOsCdrCampos | null | undefined,
  textos: Record<string, string>,
  semNome: Record<string, CdrSemNomeDraft>,
): CdrAlteracoes {
  const out: CdrAlteracoes = { textos: {}, semNome: [], count: 0 };
  if (!data) return out;
  for (const campo of data.campos) {
    const value = textos[campo.key];
    if (value !== undefined && value !== campo.texto) {
      out.textos[campo.key] = value;
    }
  }
  for (const item of data.sem_nome) {
    const draft = semNome[item.key];
    if (!draft) continue;
    const edit: PapelariaCdrSemNomeEdit = {
      static_id: item.static_id,
      pagina: item.pagina,
    };
    let changed = false;
    if (draft.texto !== undefined && draft.texto !== item.texto) {
      edit.texto = draft.texto;
      changed = true;
    }
    const nome = (draft.nome ?? "").trim();
    if (nome) {
      edit.nome = nome;
      changed = true;
    }
    if (changed) out.semNome.push(edit);
  }
  out.count = Object.keys(out.textos).length + out.semNome.length;
  return out;
}

/** Valores `cdr:` enviados pelo cliente no portal (alteração de prova). */
export function pickCdrCampos(
  campos: Record<string, string> | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!campos) return out;
  for (const [key, value] of Object.entries(campos)) {
    if (key.startsWith(CDR_FIELD_PREFIX)) out[key] = String(value ?? "");
  }
  return out;
}

export function cdrCamposEmLeitura(data: PapelariaOsCdrCampos | null | undefined): boolean {
  return data?.status === "pending" || data?.status === "processing";
}

export function cdrDisponivel(data: PapelariaOsCdrCampos | null | undefined): boolean {
  if (!data) return false;
  return data.status !== "sem_cdr" && data.status !== "sem_pasta";
}

export function formatTempoRelativo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const diff = Math.max(0, Math.round((now - t) / 1000));
  if (diff < 60) return "agora há pouco";
  const min = Math.round(diff / 60);
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return `há ${d} dia${d > 1 ? "s" : ""}`;
}
