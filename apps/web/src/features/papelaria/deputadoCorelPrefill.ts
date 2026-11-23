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

/**
 * Valor de cada fonte de preenchimento a partir do enriquecimento da Câmara
 * (espelha ``calcular_fontes`` do backend para as fontes do deputado).
 */
export function fontesDoEnriquecimento(e: Record<string, string>): Record<string, string> {
  const genero = (e["genero"] || "").trim();
  const base = genero ? (/deputada/i.test(genero) ? "Deputada" : "Deputado") : "";
  const partido = (e["partido"] || "").trim();
  const uf = (e["uf"] || "").trim().toUpperCase();
  const anexo = (e["anexo"] || "").trim();
  const gabinete = (e["gabinete"] || "").trim();
  const endereco = [anexo ? `Anexo ${anexo}` : "", gabinete ? `Gabinete ${gabinete}` : ""]
    .filter(Boolean)
    .join(", ");
  const out: Record<string, string> = {
    deputado_nome: (e["nome_deputado"] || "").trim(),
    deputado_genero: base,
    deputado_genero_federal: base ? `${base} Federal` : "",
    deputado_partido: partido,
    deputado_uf: uf,
    deputado_partido_uf: partido && uf ? `${partido}/${uf}` : partido || uf,
    deputado_email: (e["email"] || "").trim(),
    gabinete_numero: gabinete,
    gabinete_anexo: anexo,
    gabinete_endereco: endereco,
    gabinete_telefone: (e["contato_assessor"] || "").trim(),
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v));
}

/**
 * Leva o enriquecimento para as variáveis do cadastro (Configurações →
 * Variáveis): cada variável com fonte recebe o valor daquela fonte.
 */
export function aplicarVariaveisFonte(
  enrich: Record<string, string>,
  variaveisFonte?: Record<string, string> | null,
): Record<string, string> {
  if (!variaveisFonte || !Object.keys(variaveisFonte).length) return enrich;
  const fontes = fontesDoEnriquecimento(enrich);
  const out = { ...enrich };
  for (const [chave, fonte] of Object.entries(variaveisFonte)) {
    const valor = fontes[fonte];
    if (valor) out[chave] = valor;
  }
  return out;
}
