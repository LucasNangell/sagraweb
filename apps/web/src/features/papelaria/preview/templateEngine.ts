/** Substitui `{variavel}` nos templates da prévia (mesma regra da prévia textual). */
export function applyPreviewTemplate(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(/\{([^{}]+)\}/g, (_, nome: string) => {
    const key = nome.trim() === "nome_acessor" ? "nome_assessor" : nome.trim();
    return values[key] ?? "";
  });
}
