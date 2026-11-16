import type { DeputadoLookup } from "@/api/auxLookups";

function extrairNumeroGabinete(texto: string): string {
  const numeros = texto.match(/\d+/g);
  if (!numeros?.length) return "";
  let numero = numeros[numeros.length - 1] ?? "";
  if (numero.length > 3) numero = numero.slice(-3);
  return numero.padStart(3, "0");
}

function extrairAnexo(gabinete: string): string {
  const texto = gabinete.toLowerCase();
  for (const roman of ["iv", "iii", "ii", "vi", "v", "i"] as const) {
    if (new RegExp(`anexo\\s*${roman}\\b`, "i").test(texto)) {
      return roman.toUpperCase();
    }
  }
  const digit = texto.match(/anexo\s*(\d+)/i);
  if (digit?.[1] === "4") return "IV";
  return "";
}

function inferirGeneroCargo(sexo: string | undefined): string {
  const s = (sexo || "").trim().toUpperCase();
  if (s === "F") return "Deputada";
  if (s === "M") return "Deputado";
  return "";
}

function formatarFonesCamara(ramal: string | undefined): string {
  const digits = (ramal || "").replace(/\D/g, "");
  if (digits.length >= 8) {
    return `Fones: (61) ${digits.slice(0, 4)}-${digits.slice(4)}`;
  }
  if (digits.length >= 4) {
    return `Fones: (61) 3215-${digits.slice(-4)}`;
  }
  return "";
}

/**
 * Espelha ``aplicar_deputado_em_campos_corel`` no frontend para enriquecimento
 * assíncrono após o contexto local da Papelaria.
 */
export function deputadoLookupToCorelPrefill(
  dep: DeputadoLookup,
): Record<string, string> {
  const out: Record<string, string> = {};
  const nome = (dep.nome_eleitoral || dep.nome || "").trim();
  if (nome) out.nome_deputado = nome;

  const genero = inferirGeneroCargo(dep.sexo);
  if (genero) out.genero = genero;

  const partido = (dep.partido || "").trim();
  if (partido) out.partido = partido;

  const uf = (dep.uf || "").trim().toUpperCase();
  if (uf) out.uf = uf;

  const gabRaw = (dep.gabinete || "").trim();
  if (gabRaw) {
    const anexo = extrairAnexo(gabRaw);
    if (anexo) out.anexo = anexo;
    const gabinete = extrairNumeroGabinete(gabRaw);
    if (gabinete) out.gabinete = gabinete;
  }

  const email = (dep.email || "").trim().toLowerCase();
  if (email) out.email = email;

  const fones =
    (dep.fones_camara || "").trim() || formatarFonesCamara(dep.ramal);
  if (fones) out.contato_assessor = fones;

  return out;
}

/**
 * Aplica enriquecimento da Câmara sobre o formulário já aberto.
 * Campos do cliente (alteração de prova) sempre prevalecem.
 * ``contato_assessor`` só preenche se ainda estiver vazio (como no backend).
 */
export function applyCamaraCorelEnrichment(
  current: Record<string, string>,
  enrich: Record<string, string>,
  clienteCampos?: Record<string, string> | null,
): Record<string, string> {
  if (!enrich || Object.keys(enrich).length === 0) {
    return current;
  }

  const next = { ...current };
  for (const [key, raw] of Object.entries(enrich)) {
    const valor = (raw || "").trim();
    if (!valor) continue;
    if (key === "contato_assessor" && (next.contato_assessor || "").trim()) {
      continue;
    }
    next[key] = valor;
  }

  if (clienteCampos && Object.keys(clienteCampos).length > 0) {
    return { ...next, ...clienteCampos };
  }
  return next;
}
