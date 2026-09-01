import type {
  OsVinculoGrupoAndamento,
  OsVinculoGrupoConfig,
} from "./types";

export function completeVinculoAndamentos(
  pairs: Array<{ situacao?: string | null; setor?: string | null }>,
): OsVinculoGrupoAndamento[] {
  const seen = new Set<string>();
  const out: OsVinculoGrupoAndamento[] = [];
  for (const pair of pairs) {
    const situacao = (pair.situacao ?? "").trim();
    const setor = (pair.setor ?? "").trim();
    if (!situacao || !setor) {
      continue;
    }
    const key = `${situacao.toLocaleLowerCase("pt-BR")}\0${setor.toLocaleLowerCase("pt-BR")}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push({ situacao, setor });
  }
  return out;
}

export function andamentosFromGrupoConfig(
  config: OsVinculoGrupoConfig | null | undefined,
): OsVinculoGrupoAndamento[] {
  if (config?.andamentos && config.andamentos.length > 0) {
    return completeVinculoAndamentos(config.andamentos);
  }
  if (config?.situacao?.trim() && config.setor?.trim()) {
    return [
      { situacao: config.situacao.trim(), setor: config.setor.trim() },
    ];
  }
  return [];
}

export function serializeVinculoAndamentos(
  pairs: OsVinculoGrupoAndamento[],
): string {
  return completeVinculoAndamentos(pairs)
    .map((p) => `${p.situacao}\0${p.setor}`)
    .join("|");
}
