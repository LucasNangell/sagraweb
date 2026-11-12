export type PapelariaSpJobUiStatus = "generating" | "done";

export function papelariaSpJobUiKey(ano: number, nro: number): string {
  return `${ano}-${nro}`;
}
