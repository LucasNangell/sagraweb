/** Variáveis calculadas a partir de `genero`; não entram no formulário. */
export const DERIVED_PREVIEW_VARIABLES = new Set(["artigo", "genero_curto"]);

export function isDerivedPreviewVariable(nome: string): boolean {
  return DERIVED_PREVIEW_VARIABLES.has(nome.trim());
}

export function enrichDerivedTemplateValues(
  values: Record<string, string>,
): Record<string, string> {
  const feminino = (values.genero ?? "").toLowerCase().includes("deputada");
  return {
    ...values,
    artigo: feminino ? "da" : "do",
    genero_curto: feminino ? "Deputada" : "Deputado",
  };
}

/** Substitui `{variavel}` nos templates da prévia (mesma regra da prévia textual). */
export function applyPreviewTemplate(
  template: string,
  values: Record<string, string>,
): string {
  const resolvidos = enrichDerivedTemplateValues(values);
  return template.replace(/\{([^{}]+)\}/g, (_, nome: string) => {
    const key = nome.trim() === "nome_acessor" ? "nome_assessor" : nome.trim();
    return resolvidos[key] ?? "";
  });
}
